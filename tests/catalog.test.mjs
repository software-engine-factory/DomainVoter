import {test} from 'node:test';
import assert from 'node:assert/strict';
const j=globalThis.__dvJiti;
const {getSqlite}=await j.import('@/db');
const rounds=await j.import('@/lib/rounds');
const {catalogDomain,materializeDomains}=await j.import('@/lib/domain-catalog');
const {openBatchRound,blockWhere}=await j.import('@/lib/batches');
const {emptyFilters}=await j.import('@/lib/filters');
const db=getSqlite();
const names=['catqa.com','catqb.com','catqc.com','catqd.com','catqe.com','catqf.com','catqg.com'];
const view={from:null,to:null,size:20,page:1,q:'',pat:'',exact:false};
function fixture(firstOnly=false){
  const batch=Number(db.prepare(`INSERT INTO round_batches(title,filter_json,order_mode,seed,block_total,per_round,rounds_planned,remainder_mode,created_at)
    VALUES ('Catalog fixture','{}','name',NULL,7,3,2,'extra',0)`).run().lastInsertRowid);
  const selection=Number(db.prepare('INSERT INTO domain_selections(batch_id) VALUES (?)').run(batch).lastInsertRowid);
  for(let n=0;n<names.length;n++){
    db.prepare("INSERT INTO pool(name,lp_price,lp_currency,price_usd,imported_at) VALUES (?,?,'USD',?,0) ON CONFLICT(name) DO UPDATE SET lp_price=excluded.lp_price,price_usd=excluded.price_usd").run(names[n],10+n,10+n);
    db.prepare("INSERT INTO selection_items(selection_id,position,name,price,currency) VALUES (?,?,?,?,'USD')").run(selection,n+1,names[n],10+n);
  }
  const ids=[];
  for(const [index,[start,end]] of [[1,3],[4,6],[7,7]].entries()){
    if(firstOnly && index>0)break;
    const id=Number(db.prepare("INSERT INTO rounds(title,status,created_at,source,batch_id,batch_index) VALUES ('Catalog range','open',0,'pool',?,?)").run(batch,index+1).lastInsertRowid);
    db.prepare('INSERT INTO round_domain_ranges(round_id,selection_id,start_position,end_position,len_min,len_max,label_length) VALUES (?,?,?,?,5,5,5)').run(id,selection,start,end);
    ids.push(id);
  }
  return {batch,selection,ids};
}
test('shared catalog conserves items, positions and IDs when interaction rows are hydrated',()=>{
  const f=fixture(),[r]=f.ids;
  assert.deepEqual(f.ids.map(id=>rounds.countDomains(id)),[3,3,1]);
  const all=db.prepare('SELECT d.* FROM domain_catalog d JOIN rounds r ON r.id=d.round_id WHERE r.batch_id=? ORDER BY r.batch_index,d.position').all(f.batch);
  assert.deepEqual(all.map(x=>x.name),names);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domains WHERE round_id=?').get(r).n,0);
  assert.ok(all.every(x=>x.id<0));
  const before=rounds.queryVoteCards(r,view);
  assert.deepEqual(before.cards.map(x=>x.name),names.slice(0,3));
  materializeDomains(r,[all[0].id,all[1].id,all[0].id]);
  materializeDomains(r,[all[0].id,all[1].id]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domains WHERE round_id=?').get(r).n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domain_catalog WHERE round_id=?').get(r).n,3);
  assert.equal(rounds.countDomains(r),3);
  assert.deepEqual(rounds.queryVoteCards(r,view),before);
  const admin=db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  db.prepare('INSERT INTO votes(round_id,domain_id,user_id,created_at) VALUES (?,?,?,0)').run(r,all[0].id,admin);
  db.prepare('INSERT INTO views(round_id,domain_id,user_id,viewed_at) VALUES (?,?,?,0)').run(r,all[1].id,admin);
  assert.equal(rounds.roundCoverage(r).viewed,1);
  assert.equal(rounds.roundLabelLength(r),5);
  assert.equal(catalogDomain(all[2].id).roundId,r);
  assert.equal(catalogDomain(-999999999999),undefined);
  const subset=rounds.queryVoteCards(r,{...view,from:2,to:3});
  assert.deepEqual(subset.cards.map(x=>x.name),names.slice(1,3));
  assert.equal(subset.matched,2);
  const used=blockWhere({classes:[],providers:[],sets:[],setMode:'any',evidence:null,minUsd:null,maxUsd:null,includeUnpriced:true,order:'name',length:null,avail:'any'},true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM pool p ${used.sql} AND p.name IN (${names.map(()=>'?').join(',')})`).get(...used.params,...names).n,0);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('compact results and exports preserve opening prices while voter cards refresh live prices',()=>{
  const f=fixture(),[r]=f.ids;
  db.prepare('UPDATE pool SET lp_price=777 WHERE name=?').run(names[0]);
  assert.equal(rounds.queryVoteCards(r,view).cards[0].price,777);
  const exported=[...rounds.iterateRoundRows(r)];
  assert.deepEqual(exported.map(x=>x.price),[10,11,12]);
  const results=rounds.queryResults(r,{sort:'position',dir:'asc',page:1,pageSize:20});
  assert.deepEqual(results.rows.map(x=>x.name),names.slice(0,3));
  assert.deepEqual(results.rows.map(x=>x.price),[10,11,12]);
  assert.equal(results.total,3);
  for(const id of f.ids)rounds.deleteRound(id);
});
test('derive hydrates only referenced virtual sources and deleting a parent preserves the child',()=>{
  const f=fixture(),[r]=f.ids;
  const derived=rounds.deriveRound({title:'Derived catalog',parentRoundId:r,filters:emptyFilters()});
  assert.equal(derived.count,3);
  assert.deepEqual([...rounds.iterateRoundRows(derived.id)].map(x=>x.name),names.slice(0,3));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domains WHERE round_id=?').get(r).n,3);
  assert.ok(rounds.deleteRound(r));
  assert.equal(rounds.countDomains(f.ids[1]),3);
  assert.equal(rounds.countDomains(derived.id),3);
  assert.ok(db.prepare('SELECT source_domain_id FROM domains WHERE round_id=?').all(derived.id).every(x=>x.source_domain_id===null));
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  rounds.deleteRound(derived.id);
  for(const id of f.ids.slice(1))rounds.deleteRound(id);
});
test('opening a later compact range snapshots current prices without changing the first range',()=>{
  const f=fixture(true),[first]=f.ids;
  db.prepare('UPDATE pool SET lp_price=888 WHERE name=?').run(names[3]);
  const next=openBatchRound(f.batch);
  assert.equal(next.count,3);
  assert.equal([...rounds.iterateRoundRows(next.roundId)][0].price,888);
  assert.deepEqual([...rounds.iterateRoundRows(first)].map(x=>x.price),[10,11,12]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domains WHERE round_id=?').get(next.roundId).n,0);
  const last=openBatchRound(f.batch);
  assert.equal(last.count,1);
  assert.deepEqual([...rounds.iterateRoundRows(last.roundId)].map(x=>x.name),[names[6]]);
  assert.equal(openBatchRound(f.batch).roundId,0);
  for(const id of [first,next.roundId,last.roundId])rounds.deleteRound(id);
});
test('overlapping ranges fail and reopening a deleted round never reuses its interaction IDs',()=>{
  const f=fixture(),middle=f.ids[1];
  const stale=rounds.queryVoteCards(middle,view).cards.map(x=>x.id);
  assert.throws(()=>db.prepare('UPDATE round_domain_ranges SET start_position=3 WHERE round_id=?').run(middle),/selection_range_overlap/);
  rounds.deleteRound(middle);
  const reopened=openBatchRound(f.batch);
  assert.equal(reopened.count,3);
  assert.deepEqual(rounds.queryVoteCards(reopened.roundId,view).cards.map(x=>x.name),names.slice(3,6));
  assert.ok(stale.every(id=>catalogDomain(id)===undefined));
  assert.ok(rounds.queryVoteCards(reopened.roundId,view).cards.every(x=>!stale.includes(x.id)));
  const retiredHigh=Math.max(...rounds.queryVoteCards(reopened.roundId,view).cards.map(x=>-x.id));
  for(const id of [f.ids[0],reopened.roundId,f.ids[2]])rounds.deleteRound(id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM selection_items WHERE selection_id=?').get(f.selection).n,0);
  const fresh=fixture();
  assert.ok(rounds.queryVoteCards(fresh.ids[0],view).cards.every(x=>-x.id>retiredHigh));
  for(const id of fresh.ids)rounds.deleteRound(id);
});
test('deleting a non-batch compact round removes its unused frozen selection',()=>{
  const id=rounds.createRound({title:'Compact single',parentRoundId:null,filterJson:null,sortMode:'original',rows:[]});
  const selection=Number(db.prepare('INSERT INTO domain_selections DEFAULT VALUES').run().lastInsertRowid);
  db.prepare("INSERT INTO selection_items(selection_id,position,name,price,currency) VALUES (?,1,'catqa.com',10,'USD')").run(selection);
  db.prepare('INSERT INTO round_domain_ranges(round_id,selection_id,start_position,end_position,len_min,len_max,label_length) VALUES (?,?,1,1,5,5,5)').run(id,selection);
  assert.equal(rounds.countDomains(id),1);
  assert.ok(rounds.deleteRound(id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM selection_items WHERE selection_id=?').get(selection).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domain_selections WHERE id=?').get(selection).n,0);
});
