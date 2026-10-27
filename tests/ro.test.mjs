import { test } from "node:test";
import assert from "node:assert/strict";

const j = globalThis.__dvJiti;
const ro = await j.import("@/lib/ro");
const cache = await j.import("@/lib/data-cache");
const { getSqlite } = await j.import("@/db");

test("worker reader: same rows as inline (incl. dv_browse_rank / dv_seeded_rank), chunks, errors", async () => {
  const db = getSqlite();
  const ins = db.prepare("INSERT OR IGNORE INTO pool (name, price_usd, imported_at) VALUES (?, ?, 1)");
  db.transaction(() => {
    for (let i = 0; i < 2345; i++) ins.run(`rw${String(i).padStart(4, "0")}.com`, i % 13);
  })();
  const w = ro.workerReader(2);
  const inl = ro.inlineReader();
  for (const [sql, params] of [
    ["SELECT name, price_usd FROM pool WHERE name LIKE 'rw%' ORDER BY dv_browse_rank(?, name), name LIMIT 50", ["s1"]],
    ["SELECT name FROM pool WHERE name LIKE 'rw%' ORDER BY dv_seeded_rank(?, name) LIMIT 20", ["s2"]],
    ["SELECT name_len AS length, COUNT(*) AS count FROM pool GROUP BY name_len ORDER BY name_len", []],
  ]) {
    assert.deepEqual(await w.all(sql, params), await inl.all(sql, params), sql);
  }
  assert.deepEqual(await w.get("SELECT COUNT(*) n FROM pool WHERE name LIKE 'rw%'"), { n: 2345 });
  let rows = 0;
  let chunks = 0;
  for await (const c of w.chunks("SELECT name FROM pool WHERE name LIKE 'rw%' ORDER BY name", [], 500)) {
    rows += c.length;
    chunks += 1;
  }
  assert.equal(rows, 2345);
  assert.equal(chunks, 5);
  await assert.rejects(w.all("SELECT nope FROM pool"), /no such column/);
  await assert.rejects(w.all("DELETE FROM pool WHERE 0 RETURNING name"), /readonly/i, "worker connection is read-only");
  // The writer's committed rows are visible to the worker connection.
  ins.run("rwlate.com", 1);
  assert.deepEqual(await w.get("SELECT name FROM pool WHERE name = 'rwlate.com'"), { name: "rwlate.com" });
});

test("cachedAsync: one computation for concurrent callers; a result that lands after a data change is not stored", async () => {
  let runs = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const compute = async () => {
    runs += 1;
    await gate;
    return { v: runs };
  };
  const a = cache.cachedAsync("ro-test", compute);
  const b = cache.cachedAsync("ro-test", compute);
  cache.bumpData(); // data changed while computing
  const c = cache.cachedAsync("ro-test", compute);
  release();
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(ra, rb, "shared");
  assert.equal(runs, 2, "the post-change caller started its own computation");
  assert.equal(await cache.cachedAsync("ro-test", compute), rc, "only the post-change result was stored");
});
