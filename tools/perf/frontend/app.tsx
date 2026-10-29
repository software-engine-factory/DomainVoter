import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PoolRoundForm } from '../../../src/app/admin/rounds/new/pool-form';
import { BatchForm } from '../../../src/app/admin/rounds/batch/batch-form';

const variant = new URLSearchParams(location.search).get('variant') || 'f1';
const mutant = new URLSearchParams(location.search).get('mutant');
declare global { interface Window { perfBackend: string } }
const real = window.perfBackend === 'synthetic-sqlite';
const shared = { classes: [], providers: [], users: [], lengths: [{ length: 5, count: 800000, free: 400000 }], initialLength: 5 };
type Snapshot = { id: string; state: string; phase: string; processed: number; total: number; updatedAt: number; resultUrl: string | null };
async function request(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { safeToRetry: data.safeToRetry });
  return data;
}

function Variant() {
  const [minUsd, setMin] = useState('');
  const [count, setCount] = useState<number | null>(real ? 10000 : 800000);
  const [countState, setCountState] = useState('updating');
  const [retryCount, setRetryCount] = useState(0);
  const generation = useRef(0);
  const countActive = useRef(false);
  const queuedCount = useRef<{ mine: number; minUsd: string } | null>(null);
  const [creation, setCreation] = useState(() => variant === 'f2' && sessionStorage.getItem('dv-perf-pending-v1') ? 'unknown' : 'idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const busy = useRef(false);
  const [ticket, setTicket] = useState<string | null>(() => variant === 'f2' ? localStorage.getItem('dv-perf-job-v1') : null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pollState, setPollState] = useState('');
  const [age, setAge] = useState(0);
  const [page, setPage] = useState(1);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const runCount = useCallback(async function execute(input: { mine: number; minUsd: string }) {
    countActive.current = true;
    try {
      const value = await request('/api/count', { minUsd: input.minUsd });
      if (mounted.current && (mutant === 'stale' || input.mine === generation.current)) {
        setCount(value.count); setCountState('ready');
      }
    } catch {
      if (mounted.current && input.mine === generation.current) setCountState('error');
    } finally {
      countActive.current = false;
      const next = queuedCount.current;
      queuedCount.current = null;
      if (mounted.current && next?.mine === generation.current) void execute(next);
    }
  }, []);
  useEffect(() => {
    const mine = ++generation.current;
    queuedCount.current = null;
    const timer = setTimeout(() => {
      const input = { mine, minUsd };
      if (countActive.current) queuedCount.current = input;
      else void runCount(input);
    }, 250);
    return () => clearTimeout(timer);
  }, [minUsd, retryCount, runCount]);

  const refreshJob = useCallback(async () => {
    if (!ticket) return null;
    const data: Snapshot = await request(`/api/jobs/${encodeURIComponent(ticket)}`);
    if (mounted.current) {
      setSnapshot(data); setPollState(''); setAge(Math.max(0, Date.now() - data.updatedAt));
      if (data.state === 'completed') setResult(data.resultUrl || '');
    }
    return data;
  }, [ticket]);
  useEffect(() => {
    if (!ticket) return;
    let active = true, timer: ReturnType<typeof setTimeout>, delay = 250, previous = -1;
    let inflight = false;
    const poll = async () => {
      if (!active || inflight) return;
      inflight = true;
      try {
        const data = await refreshJob();
        if (!active || !data || ['completed', 'failed', 'canceled'].includes(data.state)) return;
        delay = data.processed !== previous ? 250 : Math.min(delay * 2, 1000);
        previous = data.processed;
      } catch { if (active) setPollState('Status unavailable. Retrying.'); delay = Math.min(delay * 2, 2000); }
      finally { inflight = false; }
      if (active) timer = setTimeout(poll, document.hidden ? 2000 : delay);
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    void poll(); document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [ticket, refreshJob]);
  useEffect(() => {
    if (!snapshot) return;
    const timer = setInterval(() => setAge(Math.max(0, Date.now() - snapshot.updatedAt)), 100);
    return () => clearInterval(timer);
  }, [snapshot]);

  async function acceptJob(data: Record<string, unknown>) {
    sessionStorage.setItem('dv-perf-pending-v1', JSON.stringify(data));
    const response = await request('/api/jobs', data);
    localStorage.setItem('dv-perf-job-v1', response.id);
    sessionStorage.removeItem('dv-perf-pending-v1');
    setTicket(response.id); setCreation('accepted'); setError('');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((busy.current && mutant !== 'duplicate') || countState !== 'ready') return;
    busy.current = true; setCreation('submitting'); setError('');
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = Object.fromEntries(new FormData(event.currentTarget, submitter));
    data.createMode ??= 'all';
    try {
      if (variant === 'f1') {
        const response = await request('/api/create', data);
        if (!mounted.current) return;
        setResult(response.resultUrl); setCreation('completed'); busy.current = false;
      } else {
        let key = sessionStorage.getItem('dv-perf-key-v1');
        if (!key) { key = crypto.randomUUID(); sessionStorage.setItem('dv-perf-key-v1', key); }
        await acceptJob({ ...data, key });
      }
    } catch (failure) {
      if (!mounted.current) return;
      if ((failure as { safeToRetry?: boolean }).safeToRetry) {
        setError('Creation rejected. Edit the title and retry.'); setCreation('idle'); busy.current = false;
      } else {
        setError('Outcome unknown. Do not submit again until the result is checked.'); setCreation('unknown');
      }
    }
  }
  const locked = creation !== 'idle' || !!ticket;
  return <>
    <h2>{variant === 'f1' ? 'F1: stay on the form until creation returns' : 'F2: accept a ticket and monitor the job'}</h2>
    <form onSubmit={submit} aria-busy={creation === 'submitting'}>
      <fieldset disabled={locked}>
        <legend>{real ? 'Fixed synthetic four-letter fixture, 10,000 rows' : 'Five-letter pool'}</legend>
        <label>Minimum price <input name="minUsd" value={minUsd} onChange={e => { setCountState('updating'); setMin(e.target.value); }} /></label>
        <label>Title <input name="title" required defaultValue="Local experiment" /></label>
        <label>Order <select name="order"><option>random</option><option>name</option></select></label>
        <label>Rounds <input name="rounds" defaultValue="5" /></label>
        <label>Per round <input name="perRound" defaultValue="500" /></label>
      </fieldset>
      <p role="status" data-testid="count" data-state={countState}>
        {countState === 'error' ? 'Count unavailable' : `${count?.toLocaleString('en')} names${countState === 'updating' ? ' (updating, previous value)' : ''}`}
      </p>
      {countState === 'error' ? <button type="button" onClick={() => { setCountState('updating'); setRetryCount(n => n + 1); }}>Retry count</button> : null}
      <button name="createMode" value="all" disabled={locked || countState !== 'ready' || !count}>Create all</button>
      <button name="createMode" value="first" disabled={locked || countState !== 'ready' || !count}>Create first</button>
      <p role="status" data-testid="creation">{creation === 'submitting' ? variant === 'f1' ? 'Creating. This can take a while. Keep this page open.' : 'Submitting job.' : creation}</p>
      {error ? <p role="alert">{error}</p> : null}
      {variant === 'f2' && creation === 'unknown' ? <button type="button" onClick={async () => {
        const saved = sessionStorage.getItem('dv-perf-pending-v1');
        if (!saved) return;
        setCreation('submitting');
        try { await acceptJob(JSON.parse(saved)); }
        catch { setCreation('unknown'); setError('Ticket recovery unavailable. Retry recovery with the same request.'); }
      }}>Recover ticket</button> : null}
    </form>
    {ticket ? <section aria-label="Job monitor">
      <h3>Ticket {ticket}</h3>
      <p role="status" data-testid="job-state">{snapshot?.state || 'Loading status'}</p>
      <p data-testid="progress">{snapshot ? `${snapshot.phase}: ${snapshot.processed.toLocaleString('en')} / ${snapshot.total > 0 ? snapshot.total.toLocaleString('en') : 'total unknown'}` : 'Waiting for server progress. Total unknown.'}</p>
      {snapshot && snapshot.total > 0 ? <progress value={snapshot.processed} max={snapshot.total} /> : <progress />}
      <p data-testid="age">Snapshot age: {age} ms</p>
      <p>Reload this page to resume monitoring.</p>
      {pollState ? <p role="alert">{pollState}</p> : null}
      {snapshot && !['completed', 'failed', 'canceled'].includes(snapshot.state) ? <button type="button" onClick={async () => {
        setPollState('Cancel requested. Waiting for server.');
        try { const data = await request(`/api/jobs/${ticket}/cancel`, {}); setSnapshot(data); setPollState(''); }
        catch { setPollState('Cancellation unconfirmed. Refresh status before retrying.'); }
      }}>Cancel job</button> : null}
    </section> : null}
    {result && real ? <section><a href={result}>Open real scratch result counts</a></section> : null}
    {result && !real ? <section><a href={result}>Open result</a><p>Local result preview, page {page} of 16,000.</p>
      <ul data-testid="rows">{Array.from({ length: 50 }, (_, i) => <li key={i}>Synthetic item {(page - 1) * 50 + i + 1}</li>)}</ul>
      <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><button disabled={page >= 16000} onClick={() => setPage(p => p + 1)}>Next</button>
    </section> : null}
  </>;
}

createRoot(document.getElementById('root')!).render(variant === 'pool'
  ? <PoolRoundForm {...shared} setCounts={[]} total={800000} />
  : variant === 'batch' ? <BatchForm {...shared} setLabels={{}} poolTotal={800000} /> : <Variant />);
