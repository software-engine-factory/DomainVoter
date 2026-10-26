import { test } from "node:test";
import assert from "node:assert/strict";

const j = globalThis.__dvJiti;
const { getSqlite } = await j.import("@/db");
const pool = await j.import("@/lib/pool");
const db = getSqlite();

test("length filter + length counts", () => {
  const ins = db.prepare("INSERT INTO pool (name, price_usd, imported_at) VALUES (?, 10, 1)");
  for (const n of ["zqa.com", "zqab.com", "zqabc.com", "zqb.com"]) ins.run(n);
  const counts = pool.poolLengthCounts();
  const by = Object.fromEntries(counts.map((c) => [c.length, c.count]));
  assert.ok(by[3] >= 1 && by[4] >= 1 && by[5] >= 1, JSON.stringify(counts));
  assert.equal(pool.defaultLength(counts), 4);
  assert.equal(pool.defaultLength([{ length: 5, count: 9 }, { length: 3, count: 2 }]), 5);
  for (const n of [3, 4, 5]) {
    const f = pool.normalizePoolFilters({ length: String(n), includeUnpriced: "1" }).filters;
    assert.equal(f.length, n);
    const w = pool.poolWhere(f, "p");
    const rows = db.prepare(`SELECT p.name FROM pool p ${w.sql}`).all(...w.params);
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.name.length - 4 === n), `only ${n}-letter names`);
  }
  assert.equal(pool.normalizePoolFilters({ length: "" }).filters.length, null);
  assert.equal(pool.normalizePoolFilters({ length: "x" }).filters.length, null);
});
