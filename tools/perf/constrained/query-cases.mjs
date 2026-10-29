import {createJiti} from 'jiti';
import path from 'node:path';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const j = createJiti(import.meta.url,{alias:{'@':path.resolve('src')},interopDefault:true});
const {parseBrowse,browseWhere,browseCountSql}=await j.import('@/lib/pool-browse');
const container=process.argv[2], output=process.argv[3];
if(!container || !output)throw new Error('Pass a LOCAL perf container ID and output JSON path');
const mode=process.argv[4] ?? 'candidate';
const cases=[];
for(const [name,query,legacy,params] of [
 ['length_count',{lmin:'5',lmax:'5'},'WHERE p.name_len=5',[]],
 ['substring_count',{lmin:'5',lmax:'5',q:'ab'},"WHERE p.name_len=5 AND p.name LIKE '%ab%'",[]],
 ['long_substring_count',{lmin:'5',lmax:'5',q:'abc'},"WHERE p.name_len=5 AND p.name LIKE '%abc%'",[]],
 ['position_count',{pat:'_a_b_',exact:'1'},"WHERE p.name_len=5 AND p.name LIKE '_a_b_%'",[]],
 ['substring_page',{lmin:'5',lmax:'5',q:'ab'},"WHERE p.name_len=5 AND p.name LIKE '%ab%'",[]],
 ['position_page',{pat:'_a_b_',exact:'1'},"WHERE p.name_len=5 AND p.name LIKE '_a_b_%'",[]],
]){
 const w=mode==='baseline'?{sql:legacy,params}:browseWhere(parseBrowse(query));
 const summary=mode==='baseline'||!name.endsWith('count')?null:browseCountSql(parseBrowse(query));
 cases.push({name,sql:summary?.sql??`SELECT ${name.endsWith('count')?'COUNT(*) AS n':'p.name'} FROM pool p ${w.sql}${name.endsWith('page')?' ORDER BY p.name LIMIT 50':''}`,params:summary?.params??w.params});
}
cases.push({name:'capped_count',sql:mode==='baseline'?'SELECT MIN(2000,COUNT(*)) AS n FROM pool WHERE name_len=5':'SELECT COUNT(*) AS n FROM (SELECT 1 FROM pool WHERE name_len=5 LIMIT 2000)',params:[]});
const result=JSON.parse(execFileSync('docker',['exec','-i',container,'node','/perf/query-probe.cjs'],{input:JSON.stringify({cases,repeats:5}),encoding:'utf8',maxBuffer:4*1024*1024}));
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
fs.writeFileSync(output,JSON.stringify({mode,...result},null,2)+'\n');
console.log(JSON.stringify({output,results:result.results.map(({name,p50Ms,p95Ms,count,resultHash})=>({name,p50Ms,p95Ms,count,resultHash}))}));
