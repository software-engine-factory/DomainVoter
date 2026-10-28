// SQLite's actual extended BUSY error, not a mocked exception.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {retryBusy} from './sqlite-retry.mjs';
const dir=path.resolve(import.meta.dirname,'../../../data/perf-worker/contention');
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'voting.db');
for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});
const a=new Database(file),b=new Database(file);
a.pragma('journal_mode=WAL');a.pragma('busy_timeout=0');b.pragma('busy_timeout=0');
a.exec('CREATE TABLE counter(n INTEGER);INSERT INTO counter VALUES(0)');
let attempts=0;const codes=[];
const transaction=a.transaction(()=>{
  attempts++;a.prepare('SELECT n FROM counter').get();
  if(attempts===1)b.prepare('UPDATE counter SET n=n+1').run();
  a.prepare('UPDATE counter SET n=n+1').run();
});
await retryBusy(transaction,{onRetry:code=>codes.push(code)});
assert.deepEqual(codes,['SQLITE_BUSY_SNAPSHOT']);
assert.equal(attempts,2);assert.equal(a.prepare('SELECT n FROM counter').get().n,2);
const result={at:new Date().toISOString(),attempts,retriedCodes:codes,finalValue:2,wholeTransactionRetried:true};
a.close();b.close();
fs.writeFileSync(path.join(import.meta.dirname,'result-contention.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
