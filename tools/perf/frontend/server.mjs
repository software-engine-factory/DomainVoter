import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function startServer(port = 0) {
  // Opt-in only. Adapter owns a separate synthetic scratch DB, never the replica or app DB.
  const adapter = process.env.PERF_JOB_ADAPTER ? await import(pathToFileURL(resolve(process.env.PERF_JOB_ADAPTER)).href) : null;
  let requests = [], jobs = new Map(), serial = 0, countActive = 0, countPeakActive = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    let body = {};
    try {
      if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += chunk; body = JSON.parse(raw || '{}'); }
      if (url.pathname === '/api/reset') { requests = []; jobs.clear(); serial = 0; countPeakActive = countActive; return send({ ok: true }); }
      if (url.pathname === '/api/stats') return send({ requests, countActive, countPeakActive });
      if (url.pathname.startsWith('/api/')) requests.push({ method: req.method, path: url.pathname, at: Date.now(), body });
      if (url.pathname === '/api/count') {
        if (adapter) return send({ count: 10000 }); // Fixed synthetic adapter input. No real filter benchmark.
        countActive++; countPeakActive = Math.max(countPeakActive, countActive);
        try {
          await sleep(String(body.minUsd) === '1' ? 900 : 120);
          if (String(body.minUsd) === '999') return send({ error: 'Count temporarily unavailable' }, 503);
          return send({ count: String(body.minUsd) === '1' ? 111 : String(body.minUsd) === '2' ? 222 : String(body.minUsd) === '3' ? 333 : 800000 });
        } finally { countActive--; }
      }
      if (url.pathname === '/api/create') {
        await sleep(1800);
        if (body.title === 'reject') return send({ error: 'Rejected before creation', safeToRetry: true }, 422);
        if (body.title === 'lost') { req.socket.destroy(); return; }
        return send({ resultUrl: '/result?kind=sync' });
      }
      if (url.pathname === '/api/jobs') {
        if (adapter) return send(await adapter.submit(body), 202);
        await sleep(35);
        // Fixture idempotency. A production backend must persist key + request hash atomically.
        const existing = [...jobs.values()].find(j => j.key === body.key);
        if (existing) return send({ id: existing.id });
        const job = { id: `fixture-${++serial}`, key: body.key, createdAt: Date.now(), canceled: false, failed: body.title === 'failjob' };
        jobs.set(job.id, job);
        if (body.title === 'lostjob') {
          // Work was accepted but its acknowledgement is unreadable. No transport-level retry ambiguity.
          res.writeHead(202, { 'Content-Type': 'application/json' }); res.end('{'); return;
        }
        return send({ id: job.id }, 202);
      }
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(\/cancel)?$/);
      if (match) {
        if (adapter) {
          const snapshot = match[2] ? await adapter.cancel(match[1]) : adapter.status(match[1]);
          return send(snapshot || { error: 'Ticket unavailable' }, snapshot ? 200 : 404);
        }
        const job = jobs.get(match[1]); if (!job) return send({ error: 'Ticket unavailable' }, 404);
        await sleep(20);
        if (match[2]) job.canceled = true;
        const elapsed = Date.now() - job.createdAt;
        const processed = Math.min(800000, Math.floor(elapsed / 500) * 100000);
        const state = job.canceled ? 'canceled' : job.failed && elapsed > 1000 ? 'failed' : elapsed >= 4000 ? 'completed' : 'running';
        return send({ id: job.id, state, phase: processed < 400000 ? 'selecting' : 'writing', processed, total: 800000, updatedAt: Date.now(), resultUrl: state === 'completed' ? '/result?kind=job' : null });
      }
      if (url.pathname.startsWith('/results/') && adapter) return send(adapter.result(url.pathname.split('/')[2]));
      if (url.pathname === '/app.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(await readFile('data/perf-frontend/app.js')); }
      if (adapter && url.pathname === '/' && url.searchParams.get('variant') !== 'f2') {
        url.searchParams.set('variant', 'f2');
        res.writeHead(302, { Location: `/?${url.searchParams}` }); res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      let html = await readFile('tools/perf/frontend/index.html', 'utf8');
      if (adapter) html = html.replace('Local stub only. 800,000 is a symbolic total. No database rows are processed. Baseline mounts unchanged application form components with replaced actions.', 'Real local worker, synthetic 4L 10,000-row SQLite fixture. Fixed input; form filters ignored. No replica or production database.').replace('window.perfBackend="stub"', 'window.perfBackend="synthetic-sqlite"').replace(/<nav>[\s\S]*?<\/nav>/, '<nav><a href="?variant=f2">Real local job monitor</a></nav>');
      res.end(html);
    } catch { if (!res.headersSent) send({ error: 'Local fixture error' }, 500); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { origin } = await startServer(Number(process.env.PERF_PORT || 4318));
  console.log(`${origin} - ${process.env.PERF_JOB_ADAPTER ? 'real local worker, synthetic 4L 10000-row scratch SQLite, F2 only' : 'local stub only, no database'}`);
}
