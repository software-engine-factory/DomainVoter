import { test } from "node:test";
import assert from "node:assert/strict";

const j = globalThis.__dvJiti;
const free = await j.import("@/lib/free-names");
const cache = await j.import("@/lib/data-cache");
const pool = await j.import("@/lib/pool");
const browse = await j.import("@/lib/pool-browse");
const { getSqlite } = await j.import("@/db");

test("v13 index; free pages from the far end match the forward order (NULL ord included)", () => {
  const db = getSqlite();
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'free_names_len_ord_name_idx'").get(), "index");
  const ins = db.prepare("INSERT OR IGNORE INTO free_names (name, set_1, set_2, set_3, set_4, set_5, ord, imported_at) VALUES (?, ?, 0, 0, 0, 0, ?, 0)");
  db.transaction(() => {
    for (let i = 0; i < 437; i++) ins.run(`pgq${String(i).padStart(3, "0")}xy.com`, i % 2, i % 7 === 0 ? null : (i * 37) % 101);
  })();
  cache.bumpData();
  for (const q of [{}, { len: "8" }, { len: "8", set: "1" }, { q: "pgq1" }]) {
    const all = db
      .prepare(`SELECT name FROM free_names f ${q.len ? "WHERE f.name_len = 8" : ""} ORDER BY name_len, ord, name`)
      .all()
      .map((r) => r.name);
    const first = free.browseFree(free.parseFreeQuery(q));
    const got = [];
    for (let p = 1; p <= first.pages; p++) got.push(...free.browseFree(free.parseFreeQuery({ ...q, page: String(p) })).rows.map((r) => r.name));
    assert.equal(got.length, first.total, JSON.stringify(q));
    if (!q.set && !q.q) assert.deepEqual(got, all, `order ${JSON.stringify(q)}`);
    assert.equal(new Set(got).size, got.length, "no dupes");
  }
  const v = free.browseFreeForVoters({ len: 8, page: 4 });
  assert.equal(v.rows.length, 437 - 3 * free.VOTER_FREE_PAGE);
  assert.equal(free.browseFreeForVoters({ len: 8, page: 999 }).page, 4, "clamped to last page");
});

test("aggregates cached until the data changes (free upload, import, rollback)", () => {
  const db = getSqlite();
  const before = free.freeLengthCounts();
  db.prepare("INSERT INTO free_names (name, set_1, set_2, set_3, set_4, set_5, imported_at) VALUES ('zzcachetest.com', 0, 0, 0, 0, 0, 0)").run();
  const after = free.freeLengthCounts();
  assert.notDeepEqual(after, before, "new free rowid busts the cache");
  const lens = pool.poolLengthCounts();
  assert.equal(pool.poolLengthCounts(), lens, "same object while unchanged");
  db.prepare("INSERT INTO imports (source, started_at, finished_at) VALUES ('t', 1, 2)").run();
  assert.notEqual(pool.poolLengthCounts(), lens, "finished import busts the cache");
  const o = browse.poolOverview();
  assert.equal(browse.poolOverview(), o);
  cache.bumpData();
  assert.notEqual(browse.poolOverview(), o, "bump busts the cache");
  const n = browse.countBrowse(browse.parseBrowse({ lmin: "4", lmax: "4" }));
  assert.equal(n, db.prepare("SELECT COUNT(*) n FROM pool WHERE name_len = 4").get().n);
  assert.equal(browse.countBrowse(browse.parseBrowse({ lmin: "3", lmax: "9" })), db.prepare("SELECT COUNT(*) n FROM pool WHERE name_len BETWEEN 3 AND 9").get().n);
});
