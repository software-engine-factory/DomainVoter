import { createJiti } from "jiti";
import { execFileSync } from "node:child_process";
import path from "node:path";
const j=createJiti(import.meta.url,{alias:{"@":path.resolve("src")},interopDefault:true});
const {browseWhere,orderSql,parseBrowse}=await j.import("@/lib/pool-browse");
const q=parseBrowse({lmin:"5",lmax:"5",used:"never",sort:"name"}),w=browseWhere(q),o=orderSql(q);
const virtual=`SELECT i.name FROM selection_items i JOIN round_domain_ranges rr ON rr.selection_id=i.selection_id AND i.position BETWEEN rr.start_position AND rr.end_position JOIN rounds r ON r.id=rr.round_id AND r.creation_job_id IS NULL`;
const used=`SELECT d.name FROM domains d UNION ${virtual}`;
const cases=[
  {name:"current_not_exists",sql:`SELECT p.name FROM pool p ${w.sql} ORDER BY ${o.sql} LIMIT 51`,params:[...w.params,...o.params]},
  {name:"not_in_union",sql:`SELECT p.name FROM pool p WHERE p.name_len=5 AND p.name NOT IN (${used}) ORDER BY p.name LIMIT 51`,params:[]},
  {name:"materialized_cte_not_in",sql:`WITH used(name) AS MATERIALIZED (${used}) SELECT p.name FROM pool p WHERE p.name_len=5 AND p.name NOT IN (SELECT name FROM used) ORDER BY p.name LIMIT 51`,params:[]},
  {name:"materialized_cte_left_join",sql:`WITH used(name) AS MATERIALIZED (${used}) SELECT p.name FROM pool p LEFT JOIN used u ON u.name=p.name WHERE p.name_len=5 AND u.name IS NULL ORDER BY p.name LIMIT 51`,params:[]},
  {name:"except_union",sql:`SELECT p.name FROM pool p WHERE p.name_len=5 EXCEPT SELECT u.name FROM (${used}) u ORDER BY name LIMIT 51`,params:[]},
];
const inner=`const fs=require('fs'),crypto=require('crypto'),D=require('better-sqlite3'),db=new D('/app/data/voting.db',{readonly:true,fileMustExist:true});db.pragma('cache_size=-20000');db.pragma('temp_store=FILE');const cases=JSON.parse(fs.readFileSync(0,'utf8'));let expected;const results=cases.map(c=>{const stmt=db.prepare(c.sql),plan=db.prepare('EXPLAIN QUERY PLAN '+c.sql).all(...c.params).map(x=>x.detail),t=performance.now(),rows=stmt.all(...c.params),ms=+(performance.now()-t).toFixed(2),hash=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');if(expected&&expected!==hash)throw Error('result mismatch '+c.name);expected=hash;return{name:c.name,ms,rows:rows.length,hash,plan}});console.log(JSON.stringify({poolRows:db.prepare('SELECT count(*) n FROM pool').get().n,results}));db.close();`;
console.log(execFileSync("docker",["exec","-i","domainvoter-local-preview","node","-e",inner],{input:JSON.stringify(cases),encoding:"utf8",maxBuffer:4*1024*1024}));
