// Runs serially inside the same CPU/RAM enclosure as the application. No database writes.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const Database = createRequire('/app/server.js')('better-sqlite3');
const db = new Database('/app/data/voting.db', { readonly: true, fileMustExist: true });
db.pragma('cache_size=-20000');
db.pragma('temp_store=FILE');
const { cases, repeats = 5 } = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = [];
for (const c of cases) {
  const statement = db.prepare(c.sql);
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + c.sql).all(...c.params).map(x=>x.detail);
  const ms = [];
  let rows, resultHash;
  for (let i=0; i<repeats; i++) {
    const t = performance.now();
    rows = statement.all(...c.params);
    ms.push(performance.now()-t);
    const digest = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    if (resultHash && resultHash !== digest) throw new Error('Unstable result: '+c.name);
    resultHash = digest;
  }
  const sorted = [...ms].sort((a,b)=>a-b);
  results.push({ name:c.name, milliseconds:ms, p50Ms:sorted[Math.floor(sorted.length/2)], p95Ms:sorted.at(-1), rows:rows.length, count:rows[0]?.n ?? null, resultHash, plan });
}
const count = db.prepare('SELECT COUNT(*) n FROM pool').get().n;
process.stdout.write(JSON.stringify({poolRows:count, sqlite:db.prepare('SELECT sqlite_version() AS v').get().v, source:'Read-only native SQLite inside capped local app container. First connection sample and warm repeats; host storage cache not purged.', results}));
db.close();
