import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const j = globalThis.__dvJiti;
const { getSqlite } = await j.import("@/db");
const pool = await j.import("@/lib/pool");
const { createRoundFromPool } = await j.import("@/lib/rounds");
const batches = await j.import("@/lib/batches");
const browse = await j.import("@/lib/pool-browse");
const free = await j.import("@/lib/free-names");
const { importFile, deleteByImportTag } = await j.import("@/lib/pool-import");
const { moveFreeNamesNow, FREE_MOVE_CHUNK } = await j.import("@/db/free-move");
const cache = await j.import("@/lib/data-cache");
const db = getSqlite();

// 7-letter names so no other test file's rows match the length filter.
const sale = ["fpzsaaa", "fpzsaab", "fpzsaac"].map((n) => `${n}.com`);
const freeN = ["fpzfaaa", "fpzfaab", "fpzfaac", "fpzfaad"].map((n) => `${n}.com`);
// Seeded inside the first test: top-level code of a test file runs while other files' tests are awaiting.
const seed = () => {
  db.transaction(() => {
    const s = db.prepare("INSERT INTO pool (name, set_1, price_usd, best_price, best_currency, evidence, imported_at) VALUES (?, 1, 9, 9, 'USD', 'sale_page', 1)");
    for (const n of sale) s.run(n);
    const f = db.prepare("INSERT INTO pool (name, set_1, reg_price_usd, imported_at, avail) VALUES (?, 1, 10.44, 1, 'free')");
    for (const n of freeN) f.run(n);
  })();
  cache.bumpData();
};
const filters = (avail, extra = {}) => pool.normalizePoolFilters({ length: "7", order: "name", avail, ...extra }).filters;

test("avail filter: any / sale / free; old stored filters without avail stay sale-only", async () => {
  seed();
  assert.equal(await batches.countBlock(filters("any"), null, false), 7);
  assert.equal(await batches.countBlock(filters("sale"), null, false), 3);
  assert.equal(await batches.countBlock(filters("free"), null, false), 4);
  assert.equal(pool.normalizePoolFilters({ length: "7" }).filters.avail, "sale", "missing avail = old rule");
  assert.equal(pool.emptyPoolFilters().avail, "any");
  assert.equal(await batches.countBlock(filters("free", { sets: ["1"] }), null, false), 4, "free names carry the set flags");
  const lens = (await pool.poolLengthCounts()).find((l) => l.length === 7);
  assert.deepEqual({ count: lens.count, free: lens.free }, { count: 7, free: 4 });
  const facets = await pool.poolFacets();
  assert.ok(facets.totals.free >= 4);
});

test("round from pool mixes sale and free names; voter cards unchanged (free = no price)", async () => {
  const { id } = await createRoundFromPool("fp-mixed", filters("any"), null);
  const r = db.prepare("SELECT status, opened_at FROM rounds WHERE id = ?").get(id);
  assert.equal(r.status, "open");
  assert.ok(r.opened_at);
  const rows = db.prepare("SELECT name, position, pool_name, price FROM domains WHERE round_id = ? ORDER BY position").all(id);
  assert.deepEqual(rows.map((d) => d.name), [...freeN, ...sale].sort());
  assert.deepEqual(rows.map((d) => d.position), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(rows.every((d) => d.pool_name === d.name));
  assert.ok(rows.filter((d) => freeN.includes(d.name)).every((d) => d.price == null));
  const only = await createRoundFromPool("fp-free", filters("free"), "s1");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM domains WHERE round_id = ?").get(only.id).n, 4);
});

test("explore av filter + round from explore", async () => {
  const q = browse.parseBrowse({ lmin: "7", lmax: "7", av: "free" });
  assert.equal(q.av, "free");
  assert.equal(browse.browseToParams(q).av, "free");
  const res = await browse.browsePool(q);
  assert.deepEqual(res.rows.map((r) => r.name).sort(), freeN);
  assert.ok(res.rows.every((r) => r.avail === "free" && r.regPrice === 10.44));
  assert.equal((await browse.browsePool(browse.parseBrowse({ lmin: "7", lmax: "7", av: "sale" }))).total, 3);
  assert.equal((await browse.browsePool(browse.parseBrowse({ lmin: "7", lmax: "7" }))).total, 7);
  const made = await browse.createRoundFromBrowse("fp-explore", q);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM domains WHERE round_id = ?").get(made.id ?? made.roundId ?? made).n, 4);
});

test("batch over sale + free names freezes the block in order", async () => {
  const res = await batches.createBatch({
    title: "fp-batch", filters: filters("any"), order: "name", seed: "x", cap: null, excludeUsed: false,
    plan: { rounds: 2, perRound: 3, remainderMode: "extra" }, createNow: 0, adminId: 1,
  });
  assert.ok(res.batchId);
  const items = db.prepare("SELECT name FROM round_batch_items WHERE batch_id = ? ORDER BY position").all(res.batchId).map((r) => r.name);
  assert.deepEqual(items, [...freeN, ...sale].sort());
  const rounds = db.prepare("SELECT r.id, (SELECT COUNT(*) FROM domains d WHERE d.round_id = r.id) n FROM rounds r WHERE r.batch_id = ? ORDER BY r.id").all(res.batchId);
  assert.equal(rounds.reduce((a, r) => a + r.n, 0), 7);
});

test("sale import upgrades a free row; free import never downgrades a sale row; undo-by-tag is sale-only", async () => {
  const f = path.join(process.env.DATA_DIR, "fp-sale.csv");
  fs.writeFileSync(f, "name,length,set_1,evidence,lp_price,lp_currency,price_usd,import_tag\nfpzfaaa,7,1,sale_page,50,USD,50,fp-tag\n");
  await importFile(f, "fp");
  const up = db.prepare("SELECT avail, reg_price_usd, price_usd FROM pool WHERE name = 'fpzfaaa.com'").get();
  assert.deepEqual({ ...up }, { avail: "sale", reg_price_usd: null, price_usd: 50 });
  const g = path.join(process.env.DATA_DIR, "fp-free.csv");
  fs.writeFileSync(g, "name,length,set_1,reg_price_usd\nfpzsaaa,7,1,10.44\nfpzfnew,7,1,10.44\n");
  const r = await free.importFreeCsv(g, "fp-free");
  assert.equal(r.upserted, 1);
  assert.equal(r.skipped, 1, "sale row left alone");
  assert.equal(db.prepare("SELECT avail FROM pool WHERE name = 'fpzsaaa.com'").get().avail, "sale");
  db.prepare("UPDATE pool SET import_tag = 'fp-free' WHERE name = 'fpzsaab.com'").run();
  deleteByImportTag("fp-free");
  assert.ok(db.prepare("SELECT 1 FROM pool WHERE name = 'fpzfnew.com'").get(), "free rows are not removed by sale undo");
});

test("v14 mover drains legacy free_names into pool; sale wins on conflict; idempotent", () => {
  const cols = db.prepare("PRAGMA table_info(pool)").all().map((c) => c.name);
  for (const c of ["avail", "ord", "reg_price_usd", "reg_registrar", "cf_checked_at"]) assert.ok(cols.includes(c), c);
  const ins = db.prepare("INSERT INTO free_names (name, set_1, set_2, set_3, set_4, set_5, ord, imported_at, reg_price_usd) VALUES (?, 1, 0, 0, 0, 0, ?, 1, 10.44)");
  db.transaction(() => {
    for (let i = 0; i < 4500; i++) ins.run(`fpmv${String(i).padStart(5, "0")}.com`, i);
    ins.run("fpzsaac.com", 0); // already for sale
  })();
  const st = moveFreeNamesNow(db);
  assert.equal(st.moved, 4500);
  assert.equal(st.chunks, Math.ceil(4501 / FREE_MOVE_CHUNK)); // 4500 + the sale conflict row
  assert.equal(db.prepare("SELECT COUNT(*) n FROM free_names").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pool WHERE name LIKE 'fpmv%' AND avail = 'free' AND reg_price_usd = 10.44").get().n, 4500);
  assert.equal(db.prepare("SELECT avail FROM pool WHERE name = 'fpzsaac.com'").get().avail, "sale");
  assert.equal(moveFreeNamesNow(db).moved, 0);
});
