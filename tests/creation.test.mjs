import { test } from 'node:test';
import assert from 'node:assert/strict';
const j = globalThis.__dvJiti;
const { getSqlite } = await j.import('@/db');
const jobs = await j.import('@/lib/creation-jobs');
const { creationInput } = await j.import('@/lib/creation-input');
const { listRounds } = await j.import('@/lib/rounds');
const db = getSqlite();
const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
const prefix = 'creation-fixture';
db.transaction(() => {
  const insert = db.prepare("INSERT OR IGNORE INTO pool(name,dns_ns_class,dns_parking_provider,price_usd,lp_price,lp_currency,set_1,set_3,imported_at) VALUES (?,?,?,?,?,'USD',?,?,0)");
  for (let i = 0; i < 10005; i++) {
    let n = i, label = '';
    for (let k = 0; k < 4; k++) { label = String.fromCharCode(97 + n % 26) + label; n = Math.floor(n / 26); }
    insert.run('j' + label + '.com', prefix, i % 2 ? 'b' : 'a', i % 17, i % 17, i % 2, i % 3 === 0 ? 1 : 0);
  }
})();
function form(order = 'name', cap = 2005) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ title: 'Creation fixture', order, cap, seed: 'creation-seed', rounds: 2, perRound: 1000, remainderMode: 'extra', avail: 'any', includeUnpriced: '1', classes: prefix, assignees: admin })) f.set(k, String(v));
  return f;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(id, predicate, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = jobs.getCreationJob(id, admin);
    if (predicate(r)) return r;
    if (r.state === 'failed') assert.fail('job failed: ' + r.error);
    await wait(3);
  }
  assert.fail('job timeout: ' + id);
}
function membership(job) {
  return db.prepare('SELECT d.name,d.position,d.price,d.currency,r.batch_index FROM domains d JOIN rounds r ON r.id=d.round_id WHERE r.batch_id=? ORDER BY r.batch_index,d.position').all(job.batch_id);
}

test('job replay, one writer, exact partial chunk, prices and assignments', async () => {
  const input = creationInput(form(), 'batch');
  const before = db.prepare('SELECT COUNT(*) n FROM votes').get().n;
  const id = jobs.acceptCreationJob(admin, 'creation-admission-key', input);
  assert.equal(jobs.acceptCreationJob(admin, 'creation-admission-key', input), id);
  assert.throws(() => jobs.acceptCreationJob(admin, 'creation-admission-key', { ...input, title: 'Different' }), /idempotency_conflict/);
  assert.throws(() => jobs.acceptCreationJob(admin, 'another-creation-key', input), /capacity/);
  assert.equal(jobs.getCreationJob(id, admin + 10000), undefined);
  const done = await until(id, r => r.state === 'completed');
  const rows = membership(done);
  const expected = db.prepare('SELECT name,lp_price FROM pool WHERE dns_ns_class=? ORDER BY name LIMIT 2005').all(prefix);
  assert.deepEqual(rows.map(r => r.name), expected.map(r => r.name));
  assert.deepEqual(rows.map(r => r.price), expected.map(r => r.lp_price));
  assert.equal(new Set(rows.map(r => r.name)).size, 2005);
  assert.deepEqual([1, 2, 3].map(n => rows.filter(r => r.batch_index === n).length), [1000, 1000, 5]);
  assert.ok(rows.every((r, i) => r.position === i % 1000 + 1 && r.currency === 'USD'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM round_assignees a JOIN rounds r ON r.id=a.round_id WHERE r.batch_id=? AND a.user_id=?').get(done.batch_id, admin).n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM votes').get().n, before);
});

for (const order of ['random', 'name', 'price_asc', 'price_desc', 'provider', 'set']) test('job selector retains legacy ordered membership: ' + order, async () => {
  const f = form(order, 105), input = creationInput(f, 'batch');
  // Characterization oracle: the unchanged legacy window/aggregation selector.
  db.function('dv_seeded_rank', { deterministic: true }, (seed, name) => {
    let h = 0x811c9dc5; for (const char of `${seed}:${name}`) { h ^= char.charCodeAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0;
  });
  const legacy = db.prepare(`SELECT name FROM (SELECT p.name,ROW_NUMBER() OVER (ORDER BY ${order === 'random' ? 'dv_seeded_rank(?,p.name),p.name' : order === 'name' ? 'p.name' : order === 'price_asc' ? 'p.price_usd IS NULL,p.price_usd,p.name' : order === 'price_desc' ? 'p.price_usd IS NULL,p.price_usd DESC,p.name' : order === 'provider' ? 'p.dns_ns_class IS NULL,p.dns_ns_class,p.dns_parking_provider IS NULL,p.dns_parking_provider,p.name' : 'p.set_1 DESC,p.set_3 DESC,p.set_4 DESC,p.set_5 DESC,p.name'}) rn FROM pool p WHERE p.dns_ns_class=?) ORDER BY rn LIMIT 105`);
  const expected = legacy.all(...(order === 'random' ? ['creation-seed', prefix] : [prefix])).map(r => r.name);
  const id = jobs.acceptCreationJob(admin, 'order-creation-' + order, input);
  const done = await until(id, r => r.state === 'completed');
  assert.deepEqual(membership(done).map(r => r.name), expected);
});

test('partial rounds stay hidden and cancellation preserves existing rows', async () => {
  const input = creationInput(form('name', 10005), 'batch');
  const before = db.prepare('SELECT COUNT(*) n FROM domains').get().n;
  const id = jobs.acceptCreationJob(admin, 'cancel-creation-key', input);
  const partial = await until(id, r => r.inserted > 0 && r.state === 'running');
  const owned = db.prepare('SELECT id FROM rounds WHERE creation_job_id=?').all(id).map(r => r.id);
  assert.ok(owned.length > 0);
  assert.ok(listRounds(admin).every(r => !owned.includes(r.id)));
  assert.ok(listRounds().every(r => !owned.includes(r.id)));
  jobs.changeCreationJob(id, admin, 'cancel');
  await until(id, r => r.state === 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM domains').get().n, before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM round_batch_items WHERE batch_id=?').get(partial.batch_id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rounds WHERE creation_job_id=?').get(id).n, 0);
});

test('worker termination resumes committed rows without duplicate names or positions', async () => {
  const input = creationInput(form('name', 10005), 'batch');
  const id = jobs.acceptCreationJob(admin, 'resume-creation-key', input);
  await until(id, r => r.staged >= 1000 && r.state === 'running');
  const worker = globalThis.dvCreationWorkers.get(id);
  assert.ok(worker);
  await worker.terminate();
  jobs.startCreationJob(id);
  const done = await until(id, r => r.state === 'completed');
  const rows = membership(done);
  assert.equal(rows.length, 10005);
  assert.equal(new Set(rows.map(r => r.name)).size, 10005);
  assert.deepEqual(rows.map(r => r.name), db.prepare('SELECT name FROM pool WHERE dns_ns_class=? ORDER BY name').all(prefix).map(r => r.name));
});

test('empty selection fails explicitly without publishing a round', async () => {
  const f = form(); f.set('classes', 'no-creation-match');
  const id = jobs.acceptCreationJob(admin, 'empty-creation-key', creationInput(f, 'batch'));
  const row = await until(id, r => r.state === 'failed');
  assert.equal(row.error, 'no_matches');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rounds WHERE creation_job_id=?').get(id).n, 0);
});

test('local dev origin follows the browser host and rejects foreign origins', () => {
  const request = origin => new Request('http://localhost:1254/api/creation-jobs', { headers: { host: '127.0.0.1:1254', origin } });
  assert.equal(jobs.sameCreationOrigin(request('http://127.0.0.1:1254')), true);
  assert.equal(jobs.sameCreationOrigin(request('https://example.org')), false);
});

test('pool job publishes one filtered round without a synthetic batch', async () => {
  const f = form('name'); f.set('minUsd', '16'); f.set('maxUsd', '16');
  const expected = db.prepare('SELECT name FROM pool WHERE dns_ns_class=? AND price_usd=16 ORDER BY name').all(prefix).map(r => r.name);
  const id = jobs.acceptCreationJob(admin, 'single-pool-creation-key', creationInput(f, 'pool'));
  const done = await until(id, r => r.state === 'completed');
  const rows = db.prepare('SELECT name,position FROM domains WHERE round_id=? ORDER BY position').all(done.round_id);
  assert.deepEqual(rows.map(r => r.name), expected);
  assert.ok(rows.every((r, i) => r.position === i + 1));
  assert.equal(done.batch_id, null);
  assert.equal(db.prepare('SELECT creation_job_id,status FROM rounds WHERE id=?').get(done.round_id).creation_job_id, null);
});

test('explore job preserves substring and length filters', async () => {
  const f = new FormData(); f.set('title', 'Explore fixture'); f.set('explore', 'q=jaaa&lmin=5&lmax=5&sort=name');
  const expected = db.prepare("SELECT name FROM pool WHERE name LIKE '%jaaa%' AND name_len=5 ORDER BY name").all().map(r => r.name);
  const id = jobs.acceptCreationJob(admin, 'explore-creation-key', creationInput(f, 'explore'));
  const done = await until(id, r => r.state === 'completed');
  assert.deepEqual(db.prepare('SELECT name FROM domains WHERE round_id=? ORDER BY position').all(done.round_id).map(r => r.name), expected);
});
