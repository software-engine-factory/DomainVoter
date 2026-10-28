// Dedicated writer thread. Every persisted data chunk shares a transaction with its checkpoint.
import { parentPort,workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import {retryBusy} from './sqlite-retry.mjs';
const db = new Database(workerData.filename, {fileMustExist:true});
db.pragma('busy_timeout = 0'); db.pragma('foreign_keys = ON');
db.function('dv_seeded_rank',{deterministic:true},(seed,name)=>{
  let h=0x811c9dc5;const text=`${seed}:${name}`;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;
});
const id = workerData.jobId;
const read = () => db.prepare('SELECT * FROM perf_jobs WHERE id=?').get(id);
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
let busyRetries=0;
const busyCodes={};
const retry=fn=>retryBusy(fn,{onRetry:code=>{busyRetries++;busyCodes[code]=(busyCodes[code]??0)+1;}});
let job = read();
const input = JSON.parse(job.input);
const tx = fn => retry(db.transaction(fn).immediate);
const chunkMs=[];
try {
  await retry(()=>db.prepare("UPDATE perf_jobs SET status='running',updated_at=? WHERE id=?").run(Date.now(),id));
  // Immutable local fixture assumption. A mutable production pool requires a versioned source snapshot.
  let names;
  if(job.phase==='selecting'||job.phase==='staging') {
    const order=input.order==='random'?'dv_seeded_rank(?,p.name),p.name':'p.name';
    const params=[...(input.order==='random'?[input.seed]:[]),input.length,...(input.order==='random'?[input.seed]:[]),input.cap];
    const excluded=input.excludeUsed?'AND p.name NOT IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL)':'';
    const row=db.prepare(`SELECT group_concat(name,char(10) ORDER BY rn) names,COUNT(*) total FROM (
      SELECT p.name,ROW_NUMBER() OVER(ORDER BY ${order}) rn FROM (
        SELECT p.name FROM pool p WHERE p.name_len=? ${excluded} ORDER BY ${order} LIMIT ?
      ) p)`).get(...params);
    names = row.names?.split('\n')??[];
    await retry(()=>db.prepare("UPDATE perf_jobs SET phase='staging',total=?,updated_at=? WHERE id=?").run(row.total,Date.now(),id));
  }
  for(;;) {
    job=read();
    if(job.cancel) {
      await retry(()=>db.prepare("UPDATE perf_jobs SET status='cancelling',phase='cleanup' WHERE id=?").run(id));
      for(const table of ['domains','round_batch_items']) {
        const predicate=table==='domains'?'round_id IN (SELECT id FROM rounds WHERE batch_id=?)':'batch_id=?';
        const sql=table==='domains'?`DELETE FROM domains WHERE id IN (SELECT id FROM domains WHERE ${predicate} LIMIT ?)`:`DELETE FROM round_batch_items WHERE batch_id=? AND position IN (SELECT position FROM round_batch_items WHERE batch_id=? LIMIT ?)`;
        for(;;) {const n=await tx(()=>db.prepare(sql).run(...(table==='domains'?[job.batch_id,input.chunk]:[job.batch_id,job.batch_id,input.chunk])).changes); if(!n)break;await wait(input.pauseMs);}
      }
      await tx(()=>{
        db.prepare('DELETE FROM rounds WHERE batch_id=?').run(job.batch_id);
        db.prepare('DELETE FROM round_batches WHERE id=?').run(job.batch_id);
        db.prepare("UPDATE perf_jobs SET status='cancelled',updated_at=? WHERE id=?").run(Date.now(),id);
      });
      break;
    }
    if(job.phase==='staging') {
      const part=names.slice(job.staged,job.staged+input.chunk);
      if(!part.length) {await retry(()=>db.prepare("UPDATE perf_jobs SET phase='materializing' WHERE id=?").run(id));continue;}
      const t=performance.now();
      await tx(()=>{
        db.prepare('INSERT INTO round_batch_items(batch_id,position,name) SELECT ?,?+CAST(key AS INTEGER)+1,value FROM json_each(?)').run(job.batch_id,job.staged,JSON.stringify(part));
        db.prepare('UPDATE perf_jobs SET staged=staged+?,updated_at=? WHERE id=?').run(part.length,Date.now(),id);
      });
      chunkMs.push(performance.now()-t);
    } else if(job.phase==='materializing') {
      if(job.inserted===job.total) {
        await tx(()=>{
          db.prepare("UPDATE rounds SET status='open',opened_at=? WHERE batch_id=?").run(Date.now(),job.batch_id);
          db.prepare('UPDATE round_batches SET block_total=? WHERE id=?').run(job.total,job.batch_id);
          db.prepare("UPDATE perf_jobs SET status='done',phase='done',updated_at=? WHERE id=?").run(Date.now(),id);
        });break;
      }
      const t=performance.now();
      await tx(()=>{
        const per=input.perRound??input.cap;
        const index=Math.floor(job.inserted/per)+1;
        const offset=(index-1)*per;
        let round=db.prepare('SELECT id FROM rounds WHERE batch_id=? AND batch_index=?').get(job.batch_id,index);
        if(!round)round={id:Number(db.prepare("INSERT INTO rounds(title,status,created_at,source,batch_id,batch_index) VALUES ('local performance job','closed',?,'pool',?,?)").run(Date.now(),job.batch_id,index).lastInsertRowid)};
        const stop=Math.min(job.total,job.inserted+input.chunk,offset+per);
        const count=db.prepare(`INSERT INTO domains(round_id,position,name,price,is_premium,pool_name,currency)
          SELECT ?,i.position-?,p.name,COALESCE(p.lp_price,p.best_price),0,p.name,p.lp_currency
          FROM round_batch_items i JOIN pool p ON p.name=i.name
          WHERE i.batch_id=? AND i.position>? AND i.position<=? ORDER BY i.position`).run(round.id,offset,job.batch_id,job.inserted,stop).changes;
        if(count!==stop-job.inserted) throw new Error('source conservation failed');
        db.prepare('UPDATE perf_jobs SET inserted=inserted+?,updated_at=? WHERE id=?').run(count,Date.now(),id);
      });
      chunkMs.push(performance.now()-t);
    } else throw new Error('unexpected phase');
    if(workerData.stopAfterChunks&&chunkMs.length>=workerData.stopAfterChunks) {setInterval(()=>{},1000);parentPort.postMessage({checkpoint:true});await new Promise(()=>{});}
    if(workerData.failAfterChunks&&chunkMs.length>=workerData.failAfterChunks) throw new Error('injected failure');
    await wait(input.pauseMs);
  }
  parentPort.postMessage({done:true,status:read().status,chunkCount:chunkMs.length,chunkMaxMs:Math.max(0,...chunkMs),busyRetries,busyCodes,transactionMode:'immediate'});
} catch(e) {
  await retry(()=>db.prepare("UPDATE perf_jobs SET status='error',error=?,updated_at=? WHERE id=?").run(e.code??'worker_failure',Date.now(),id));
  parentPort.postMessage({done:true,status:'error',busyRetries,busyCodes,transactionMode:'immediate'});
} finally {db.close();}
