// Optional local UI adapter. Synthetic fixture only, no application database.
import fs from 'node:fs';
import path from 'node:path';
import {createJiti} from 'jiti';
import {accept,start,install} from './queue.mjs';
import {retryBusy} from './sqlite-retry.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const dir=path.join(root,'data/perf-worker/ui');
fs.mkdirSync(dir,{recursive:true});
process.env.DATA_DIR=dir;process.env.DV_FREE_MOVE='off';
const jiti=createJiti(import.meta.url,{alias:{'@':path.join(root,'src')},interopDefault:true});
const {getSqlite}=await jiti.import(path.join(root,'src/db/index.ts'));
const db=getSqlite();
install(db);
if(!db.prepare('SELECT 1 FROM pool LIMIT 1').get())db.transaction(()=>{
  const insert=db.prepare('INSERT INTO pool(name,imported_at) VALUES (?,?)');
  for(let i=0;i<10000;i++){
    let n=i,name='';for(let j=0;j<4;j++){name=String.fromCharCode(97+n%26)+name;n=Math.floor(n/26);}
    insert.run(name+'.invalid',Date.now());
  }
})();
db.pragma('busy_timeout = 0');
const retry=retryBusy;
export async function submit(){
  const accepted=await retry(()=>accept(db,{length:4,cap:10000,chunk:1000,pauseMs:5,perRound:10000,rounds:1}));
  if(!accepted.accepted){const e=new Error('capacity');e.statusCode=429;throw e;}
  const active=start(db,accepted.jobId);
  active.done.catch(()=>{});
  return {id:String(accepted.jobId)};
}
export function status(id){
  const row=db.prepare('SELECT id,status,phase,staged,inserted,total,updated_at FROM perf_jobs WHERE id=?').get(Number(id));
  if(!row)return null;
  const states={done:'completed',cancelled:'canceled',error:'failed'};
  return {id:String(row.id),state:states[row.status]??'running',phase:row.phase,processed:row.phase==='staging'?row.staged:row.inserted,total:row.total,updatedAt:row.updated_at,resultUrl:`/results/${row.id}`};
}
export async function cancel(id){
  await retry(()=>db.prepare("UPDATE perf_jobs SET cancel=1 WHERE id=? AND status IN ('queued','running','cancelling')").run(Number(id)));
  return status(id);
}
export function result(id){
  const job=db.prepare('SELECT status,batch_id FROM perf_jobs WHERE id=?').get(Number(id));
  if(!job||job.status!=='done')return null;
  return db.prepare('SELECT COUNT(*) count,COUNT(DISTINCT name) uniqueNames,MIN(position) firstPosition,MAX(position) lastPosition FROM domains WHERE round_id IN (SELECT id FROM rounds WHERE batch_id=?)').get(job.batch_id);
}
