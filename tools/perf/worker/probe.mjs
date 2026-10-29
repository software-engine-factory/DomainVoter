import { parentPort, workerData } from 'node:worker_threads';
import http from 'node:http';
// Separate thread timestamps see a blocked server event loop, unlike its own timers.
const pending=new Set();
let stopped=false;
let startedCount=0,completedCount=0;
function maybeDrained(){if(stopped&&pending.size===0)parentPort.postMessage({drained:true,startedCount,completedCount});}
function request(kind) {
  startedCount++;
  const start = performance.now();
  let finished=false;
  const finish=(status,error)=>{
    if(finished)return;finished=true;pending.delete(req);
    completedCount++;
    parentPort.postMessage({kind,started:start,ms:performance.now()-start,status,error});
    maybeDrained();
  };
  const req=http.get({ hostname:'127.0.0.1', port:workerData.port, path:kind==='write'?'/write':'/' }, res => {
    res.resume();res.on('end',()=>finish(res.statusCode,null));
    res.on('error',()=>finish(res.statusCode,'response_error'));
  });
  pending.add(req);
  req.on('error',e=>finish(null,e.code??'request_error'));
  req.setTimeout(12000,()=>req.destroy(Object.assign(new Error('probe timeout'),{code:'PROBE_TIMEOUT'})));
}
const pingTimer=setInterval(()=>request('ping'),25);
const writeTimer=setInterval(()=>request('write'),100);
parentPort.on('message',m=>{
  if(m.stop){stopped=true;clearInterval(pingTimer);clearInterval(writeTimer);maybeDrained();}
});
