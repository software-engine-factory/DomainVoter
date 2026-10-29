import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=import.meta.dirname;
const range=a=>({min:Math.min(...a),median:a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)],max:Math.max(...a)});
const rows=[];
for(const length of [4,5])for(const mode of ['baseline-batch','worker']) {
  const samples=length===5?['r1']:['r1','r2','r3'];
  const results=samples.map(run=>JSON.parse(fs.readFileSync(path.join(dir,`result-${mode}-${length}-800000-${run}.json`),'utf8')));
  assert(results.every(r=>r.conservationPass&&r.voteCountPreserved&&r.probeErrors.length===0&&r.writeFailures===0));
  assert(results.every(r=>r.probeDrain.startedCount===r.probeDrain.completedCount));
  rows.push({mode,length,runs:samples.length,wallSeconds:range(results.map(r=>r.wallMs/1000)),pingP95Ms:range(results.map(r=>r.httpPing.p95Ms)),pingMaxMs:Math.max(...results.map(r=>r.httpPing.maxMs)),voteP95Ms:range(results.map(r=>r.httpVoteShapedWrite.p95Ms)),voteMaxMs:Math.max(...results.map(r=>r.httpVoteShapedWrite.maxMs)),peakRssMiB:Math.max(...results.map(r=>r.processHighWaterRssBytes/1024/1024)),cpuSeconds:range(results.map(r=>(r.cpuMs.user+r.cpuMs.system)/1000)),webBusyRetries:results.reduce((n,r)=>n+r.busyRetries,0),workerBusyRetries:results.reduce((n,r)=>n+(r.result.workerTiming?.busyRetries??0),0),successfulVoteProbes:results.reduce((n,r)=>n+(r.statusCounts['write:200']??0),0),count:results[0].count.n,rounds:results[0].rounds,orderedNamesSha256:results[0].orderedNamesSha256,allConserved:true});
  rows.at(-1).sourceFiles=samples.map(run=>`tools/perf/worker/result-${mode}-${length}-800000-${run}.json`);
  assert.equal(new Set(results.map(r=>r.orderedNamesSha256)).size,1);
}
for(const length of [4,5])assert.equal(new Set(rows.filter(r=>r.length===length).map(r=>r.orderedNamesSha256)).size,1);
const compatibility=JSON.parse(fs.readFileSync(path.join(dir,'result-worker-5-800000-compatibility.json'),'utf8'));
assert(compatibility.conservationPass&&compatibility.voteCountPreserved&&compatibility.probeErrors.length===0&&compatibility.writeFailures===0);
assert.equal(compatibility.orderedNamesSha256,rows.find(r=>r.mode==='worker'&&r.length===5).orderedNamesSha256);
assert.equal(compatibility.probeDrain.startedCount,compatibility.probeDrain.completedCount);
const output={at:new Date().toISOString(),rows,compatibility:{runs:1,busyTimeoutMs:compatibility.busyTimeoutMs,wallSeconds:compatibility.wallMs/1000,httpPing:compatibility.httpPing,httpVoteShapedWrite:compatibility.httpVoteShapedWrite,webBusyRetries:compatibility.busyRetries,workerBusyRetries:compatibility.result.workerTiming.busyRetries,writeFailures:compatibility.writeFailures,probeErrors:compatibility.probeErrors.length,probeDrain:compatibility.probeDrain}};
output.compatibility.sourceFile='tools/perf/worker/result-worker-5-800000-compatibility.json';
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
