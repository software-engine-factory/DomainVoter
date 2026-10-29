import path from 'node:path';
import { Worker } from 'node:worker_threads';

export function install(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS perf_jobs (
    id INTEGER PRIMARY KEY, status TEXT NOT NULL, phase TEXT NOT NULL,
    input TEXT NOT NULL, staged INTEGER NOT NULL DEFAULT 0,
    inserted INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
    round_id INTEGER NOT NULL, batch_id INTEGER NOT NULL,
    cancel INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at INTEGER NOT NULL
  )`);
}
export function accept(db, input) {
  install(db);
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM perf_jobs WHERE status IN ('queued','running','cancelling')").get()) return { accepted:false, reason:'capacity', retryAfterSeconds:2 };
    const now = Date.now();
    const batchId = Number(db.prepare("INSERT INTO round_batches(title,filter_json,order_mode,seed,block_total,per_round,rounds_planned,remainder_mode,created_at) VALUES ('local performance job',?,?,?,0,?,?,'extra',?)").run(JSON.stringify({length:input.length,cap:input.cap,excludeUsed:input.excludeUsed}),input.order??'name',input.seed??null,input.perRound??input.cap,input.rounds??1,now).lastInsertRowid);
    const roundId = Number(db.prepare("INSERT INTO rounds(title,status,created_at,source,batch_id,batch_index) VALUES ('local performance job','closed',?,'pool',?,1)").run(now,batchId).lastInsertRowid);
    const jobId = Number(db.prepare("INSERT INTO perf_jobs(status,phase,input,round_id,batch_id,updated_at) VALUES ('queued','selecting',?,?,?,?)").run(JSON.stringify(input),roundId,batchId,now).lastInsertRowid);
    return { accepted:true, jobId, roundId, batchId };
  })();
}
export function start(db, jobId, options={}) {
  const filename = db.name;
  if (!path.resolve(filename).includes(path.join('data','perf-worker'))) throw new Error('scratch DB required');
  const worker = new Worker(new URL('./writer.mjs',import.meta.url), {workerData:{ filename,jobId,...options }});
  const done = new Promise((resolve,reject) => {
    worker.on('message',m => { if(m.done) resolve(m); });
    worker.on('error',reject);
    worker.on('exit',code => { if(code!==0) reject(new Error(`worker exit ${code}`)); });
  });
  return {worker,done};
}
export async function runJob(db,input) {
  const accepted = accept(db,input);
  if(!accepted.accepted) throw new Error('admission rejected');
  const timing=await start(db,accepted.jobId).done;
  const job = db.prepare('SELECT status,phase,staged,inserted,total,round_id roundId,batch_id batchId FROM perf_jobs WHERE id=?').get(accepted.jobId);
  if(job.status!=='done') throw new Error(`job ${job.status}`);
  const created=db.prepare('SELECT id FROM rounds WHERE batch_id=? ORDER BY batch_index').all(job.batchId).map(r=>r.id);
  return {...job,jobId:accepted.jobId,created,workerTiming:timing};
}
