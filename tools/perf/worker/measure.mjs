// Research only. Never run against an application DATA_DIR.
import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { Worker } from 'node:worker_threads';
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import {retryBusy} from './sqlite-retry.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const scratch = path.join(root, 'data/perf-worker');
if(process.env.PERF_SOURCE) {
  if(path.resolve(process.env.PERF_SOURCE)===path.join(scratch,'voting.db'))throw new Error('source must differ from scratch');
  fs.mkdirSync(scratch,{recursive:true});
  for(const suffix of ['-wal','-shm'])fs.rmSync(path.join(scratch,'voting.db'+suffix),{force:true});
  fs.copyFileSync(process.env.PERF_SOURCE,path.join(scratch,'voting.db'));
}
process.env.DATA_DIR = scratch;
process.env.DV_FREE_MOVE = 'off';
process.env.DV_RO_WORKERS = '2';
const mode = process.argv[2] ?? 'baseline-batch';
const length = Number(process.argv[3] ?? 4);
const cap = Number(process.argv[4] ?? 10000);
const run = process.argv[5] ?? 'pilot';
const standard=process.env.PERF_STANDARD==='1';
const busyTimeout=Number(process.env.PERF_BUSY_MS??0);
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') }, interopDefault: true });
const { getSqlite } = await jiti.import(path.join(root, 'src/db/index.ts'));
const { createBatch } = await jiti.import(path.join(root, 'src/lib/batches.ts'));
const { orderedNames, createPoolRound } = await jiti.import(path.join(root, 'src/lib/bulk-fill.ts'));
const { reader } = await jiti.import(path.join(root, 'src/lib/ro.ts'));
const db = getSqlite();
await Promise.all([reader().get('SELECT 1'),reader().get('SELECT 1')]);
db.exec('CREATE TABLE IF NOT EXISTS perf_writer_probe (id INTEGER PRIMARY KEY, n INTEGER NOT NULL); INSERT OR IGNORE INTO perf_writer_probe VALUES (1,0)');
const filters = { classes: [], providers: [], sets: [], setMode: 'any', evidence: 'any', minUsd: null, maxUsd: null, includeUnpriced: true, order: 'name', length, avail: 'any' };
const input = { title: 'local performance sample', filters, order: standard?'random':'name', seed: standard?'perf-2026-10-28':'perf-fixed', cap, excludeUsed: standard, plan: { perRound: standard?10000:cap, rounds: standard?80:1, remainderMode: 'extra' }, createNow: standard?0:1, adminId: 0, assignees: [] };
const eligibleAtStart=db.prepare(`SELECT COUNT(*) n FROM pool p WHERE p.name_len=? ${input.excludeUsed?'AND p.name NOT IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL)':''}`).get(length).n;
const expectedTotal=Math.min(cap,eligibleAtStart);
const user=db.prepare('SELECT id FROM users LIMIT 1').get();
const domain=db.prepare("SELECT d.id,d.round_id FROM domains d JOIN rounds r ON r.id=d.round_id WHERE r.status='open' AND NOT EXISTS(SELECT 1 FROM votes v WHERE v.domain_id=d.id AND v.user_id=?) LIMIT 1").get(user.id);
const voteCountBefore=db.prepare('SELECT COUNT(*) n FROM votes').get().n;
const vote=db.transaction(()=>{
  db.prepare('INSERT INTO votes(round_id,domain_id,user_id,created_at) VALUES (?,?,?,?) ON CONFLICT(domain_id,user_id) DO NOTHING').run(domain.round_id,domain.id,user.id,Date.now());
  db.prepare('SELECT COUNT(*) n FROM votes WHERE round_id=? AND user_id=?').get(domain.round_id,user.id);
  db.prepare('DELETE FROM votes WHERE domain_id=? AND user_id=?').run(domain.id,user.id);
});
let busyRetries=0,writeFailures=0;
const server = createServer(async(req,res) => {
  if(req.url==='/write') {
    try{await retryBusy(vote,{onRetry:()=>{busyRetries++;}});}
    catch{writeFailures++;res.statusCode=503;}
  }
  res.end('ok');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const pings = [],httpWrites=[],probeErrors=[],statusCounts={};
const probe = new Worker(new URL('./probe.mjs', import.meta.url), { workerData: { port: server.address().port } });
let measuredStart=Infinity,measuredEnd=Infinity;
probe.on('message', m => {
  if(m.started>=measuredStart&&m.started<=measuredEnd) {
    (m.kind==='write'?httpWrites:pings).push(m.ms);
    const key=`${m.kind}:${m.status??'error'}`;statusCounts[key]=(statusCounts[key]??0)+1;
    if(m.error||m.status!==200)probeErrors.push({kind:m.kind,status:m.status,error:m.error,ms:m.ms});
  }
});
await new Promise(resolve => setTimeout(resolve, 200));
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
const writes = [], writeErrors = [];
const previousBusy = db.pragma('busy_timeout', { simple: true });
// A background writer must not synchronously wait behind SQLite's writer lock.
if (mode === 'worker') db.pragma(`busy_timeout = ${busyTimeout}`);
const voteTimer = setInterval(() => {
  const start = performance.now();
  try { db.prepare('UPDATE perf_writer_probe SET n=n+1 WHERE id=1').run(); writes.push(performance.now()-start); }
  catch (e) { writeErrors.push(e.code); }
}, 25);
let peakRss = process.memoryUsage().rss;
const memoryTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
const cpu = process.cpuUsage(), start = performance.now();
measuredStart=start;
let result;
if (mode === 'baseline-batch') result = await createBatch(input);
else if (mode === 'baseline-pool') {
  const names = await orderedNames('SELECT name, ROW_NUMBER() OVER (ORDER BY name) rn FROM (SELECT name FROM pool WHERE name_len=? ORDER BY name LIMIT ?)', [length, cap]);
  result = await createPoolRound({ title: input.title, filterJson: JSON.stringify(filters), sortMode: 'name' }, names);
} else {
  const { runJob } = await import('./queue.mjs');
  result = await runJob(db, { length, cap, order:input.order,seed:input.seed,excludeUsed:input.excludeUsed,perRound:input.plan.perRound,rounds:input.plan.rounds,chunk: 1000, pauseMs: 5 });
}
const wallMs = performance.now()-start, usedCpu = process.cpuUsage(cpu);
measuredEnd=start+wallMs;
clearInterval(voteTimer); clearInterval(memoryTimer);
const probeDrain=await new Promise((resolve,reject)=>{
  const deadline=setTimeout(()=>reject(new Error('probe drain deadline')),15000);
  probe.on('message',m=>{if(m.drained){clearTimeout(deadline);resolve({startedCount:m.startedCount,completedCount:m.completedCount});}});
  probe.postMessage({stop:true});
});
loop.disable();
await probe.terminate();
await new Promise(resolve=>server.close(resolve));
db.pragma(`busy_timeout = ${previousBusy}`);
const roundIds = result.created ?? [result.id??result.roundId];
const ids=JSON.stringify(roundIds);
const count = db.prepare('SELECT COUNT(*) n, MIN(position) lo, MAX(position) hi, COUNT(DISTINCT name) distinctNames FROM domains WHERE round_id IN (SELECT value FROM json_each(?))').get(ids);
const batchId=result.batchId;
const orderErrors = batchId?db.prepare(`SELECT COUNT(*) n FROM domains d JOIN rounds r ON r.id=d.round_id LEFT JOIN round_batch_items i ON i.batch_id=r.batch_id AND i.position=(r.batch_index-1)*?+d.position WHERE r.batch_id=? AND (i.name IS NULL OR i.name<>d.name)`).get(input.plan.perRound,batchId).n:db.prepare('SELECT COUNT(*) n FROM (SELECT name,LAG(name) OVER(ORDER BY position) previous FROM domains WHERE round_id=?) WHERE previous>name').get(roundIds[0]).n;
const roundChecks=db.prepare('SELECT COUNT(*) n,MIN(position) lo,MAX(position) hi FROM domains WHERE round_id IN (SELECT value FROM json_each(?)) GROUP BY round_id').all(ids);
const conservationPass=count.n===expectedTotal&&count.distinctNames===expectedTotal&&roundChecks.every(r=>r.lo===1&&r.hi===r.n)&&orderErrors===0;
const hash=createHash('sha256');
for(const r of db.prepare('SELECT d.name FROM domains d JOIN rounds r ON r.id=d.round_id WHERE d.round_id IN (SELECT value FROM json_each(?)) ORDER BY r.batch_index,d.position').iterate(ids))hash.update(r.name+'\n');
const orderedNamesSha256=hash.digest('hex');
const stats = values => { const a = values.toSorted((a,b)=>a-b); return { n:a.length, p95Ms:a[Math.max(0,Math.ceil(a.length*.95)-1)]??null, maxMs:a.at(-1)??null }; };
const output = { at:new Date().toISOString(), mode, run, input, expectedTotal,conservationPass,busyTimeoutMs:mode==='worker'?busyTimeout:previousBusy, wallMs, cpuMs:{ user:usedCpu.user/1000, system:usedCpu.system/1000 }, peakRssBytes:peakRss, processHighWaterRssBytes:process.resourceUsage().maxRSS*1024, httpPing:stats(pings),httpVoteShapedWrite:stats(httpWrites),probeDrain,statusCounts,probeErrors,busyRetries,writeFailures,voteCountPreserved:db.prepare('SELECT COUNT(*) n FROM votes').get().n===voteCountBefore, eventLoop:{ p95Ms:loop.percentile(95)/1e6, maxMs:loop.max/1e6 }, writerProbe:stats(writes), writerBusyErrors:writeErrors.length, count,rounds:roundIds.length,roundSizes:roundChecks.map(r=>r.n), orderErrors,orderedNamesSha256, result, responsivenessPass:pings.length>0&&stats(pings).p95Ms<250&&stats(pings).maxMs<1000 };
fs.writeFileSync(path.join(import.meta.dirname, `result-${mode}-${length}-${cap}-${run}.json`), JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(process.env.PERF_BRIEF==='1'?{mode,length,run,wallMs,httpPing:output.httpPing,httpVoteShapedWrite:output.httpVoteShapedWrite,busyRetries,conservationPass,writeFailures,probeErrors:probeErrors.length}:output));
db.close();
process.exit(output.conservationPass&&output.voteCountPreserved&&output.writeFailures===0&&output.probeErrors.length===0?0:1);
