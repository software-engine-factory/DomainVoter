import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// Sets 6-8 (migration 19): name-screening verdicts. Names here start with "zqs" so no other file's rows match.
const j = globalThis.__dvJiti;
const { getSqlite } = await j.import("@/db");
const { runMigrations, LATEST_SCHEMA_VERSION } = await j.import("@/db/migrations");
const { moveFreeNamesNow } = await j.import("@/db/free-move");
const { normalizeSetIds, ACTIVE_SETS } = await j.import("@/lib/sets");
const pool = await j.import("@/lib/pool");
const browse = await j.import("@/lib/pool-browse");
const batches = await j.import("@/lib/batches");
const free = await j.import("@/lib/free-names");
const { importFile, normalizeRow } = await j.import("@/lib/pool-import");
const cache = await j.import("@/lib/data-cache");
const db = getSqlite();

const NEW = ["set_6", "set_7", "set_8"];
const cols = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all();
const indexes = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'pool_len_set%'").all().map((r) => r.name);
const versions = (d) => d.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((r) => r.version);

test("migration 19 on a fresh database: columns, defaults, partial indexes; replay applies nothing", () => {
  assert.equal(LATEST_SCHEMA_VERSION, 19);
  assert.ok(versions(db).includes(19));
  assert.equal(db.pragma("user_version", { simple: true }), 19);
  for (const t of ["pool", "free_names"]) {
    for (const c of NEW) {
      const info = cols(db, t).find((x) => x.name === c);
      assert.ok(info, `${t}.${c}`);
      assert.equal(info.notnull, 1);
      assert.equal(info.dflt_value, "0");
    }
  }
  for (const n of [6, 7, 8]) assert.ok(indexes(db).includes(`pool_len_set${n}_idx`), `pool_len_set${n}_idx`);
  const before = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
  runMigrations(db);
  assert.deepEqual(db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all(), before);
});

test("migration 19 on a v18 database keeps every row and leaves the new sets at 0", () => {
  const file = path.join(process.env.DATA_DIR, "v18.db");
  fs.rmSync(file, { force: true });
  db.prepare("VACUUM INTO ?").run(file);
  const old = new Database(file);
  try {
    // Turn the copy back into the exact v18 shape.
    old.exec(`
      DROP INDEX pool_len_set6_idx; DROP INDEX pool_len_set7_idx; DROP INDEX pool_len_set8_idx;
      ALTER TABLE pool DROP COLUMN set_6; ALTER TABLE pool DROP COLUMN set_7; ALTER TABLE pool DROP COLUMN set_8;
      ALTER TABLE free_names DROP COLUMN set_6; ALTER TABLE free_names DROP COLUMN set_7; ALTER TABLE free_names DROP COLUMN set_8;
      DELETE FROM schema_migrations WHERE version = 19;
      PRAGMA user_version = 18;
    `);
    assert.ok(!cols(old, "pool").some((c) => NEW.includes(c.name)));
    old.prepare("INSERT INTO pool (name, set_1, set_3, set_5, price_usd, imported_at) VALUES ('zqsold.com', 1, 1, 1, 42, 7)").run();
    old.prepare("INSERT INTO pool (name, set_4, avail, reg_price_usd, imported_at) VALUES ('zqsfree.com', 1, 'free', 10.44, 7)").run();
    old.prepare("INSERT INTO free_names (name, set_1, imported_at) VALUES ('zqsleg.com', 1, 7)").run();
    const snapshot = old.prepare("SELECT * FROM pool ORDER BY name").all();
    const totals = old.prepare("SELECT * FROM pool_length_totals ORDER BY name_len, avail").all();

    runMigrations(old);
    assert.deepEqual(versions(old).filter((v) => v >= 18), [18, 19]);
    assert.equal(old.pragma("user_version", { simple: true }), 19);
    const after = old.prepare("SELECT * FROM pool ORDER BY name").all();
    assert.equal(after.length, snapshot.length);
    after.forEach((row, i) => {
      const { set_6, set_7, set_8, ...rest } = row;
      assert.deepEqual([set_6, set_7, set_8], [0, 0, 0], row.name);
      assert.deepEqual(rest, snapshot[i]);
    });
    assert.deepEqual(old.prepare("SELECT * FROM pool_length_totals ORDER BY name_len, avail").all(), totals);
    for (const n of [6, 7, 8]) assert.ok(indexes(old).includes(`pool_len_set${n}_idx`));
    assert.equal(old.prepare("SELECT set_6 + set_7 + set_8 AS s FROM free_names WHERE name = 'zqsleg.com'").get().s, 0);

    const replay = old.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
    runMigrations(old);
    assert.deepEqual(old.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all(), replay);

    // The legacy mover copies the new columns too.
    old.prepare("UPDATE free_names SET set_7 = 1 WHERE name = 'zqsleg.com'").run();
    moveFreeNamesNow(old);
    assert.deepEqual(old.prepare("SELECT avail, set_1, set_6, set_7, set_8 FROM pool WHERE name = 'zqsleg.com'").get(), { avail: "free", set_1: 1, set_6: 0, set_7: 1, set_8: 0 });
    assert.equal(old.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    old.close();
    fs.rmSync(file, { force: true });
  }
});

test("sets 6-8: labels, normalisation, Explore any/all filters, batch filters and counts", async () => {
  const rows = [
    ["zqsaa.com", { set_1: 1, set_6: 1 }],
    ["zqsab.com", { set_3: 1, set_7: 1 }],
    ["zqsac.com", { set_8: 1 }],
    ["zqsad.com", { set_3: 1, set_6: 1 }],
    ["zqsae.com", {}],
  ];
  const ins = db.prepare("INSERT INTO pool (name, set_1, set_3, set_6, set_7, set_8, imported_at) VALUES (@name, @set_1, @set_3, @set_6, @set_7, @set_8, 1)");
  try {
    db.transaction(() => rows.forEach(([name, s]) => ins.run({ name, set_1: 0, set_3: 0, set_6: 0, set_7: 0, set_8: 0, ...s })))();
    cache.bumpData();
    assert.deepEqual([...ACTIVE_SETS], [1, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(normalizeSetIds(["8", 6, 7, 9, 2]), [3, 6, 7, 8]);
    assert.deepEqual([6, 7, 8].map((n) => pool.SET_LABELS[n]), ["پیش‌پالایش‌شده", "ردشده", "ممنوع"]);

    const names = async (params) => (await browse.browsePool(browse.parseBrowse({ q: "zqsa", sort: "name", ...params }), 50, false)).rows.map((r) => r.name);
    assert.deepEqual(await names({ sets: "6" }), ["zqsaa.com", "zqsad.com"]);
    assert.deepEqual(await names({ sets: "6,7" }), ["zqsaa.com", "zqsab.com", "zqsad.com"], "any");
    assert.deepEqual(await names({ sets: "3,6", sm: "all" }), ["zqsad.com"], "all");
    assert.deepEqual(await names({ sets: "7,8", sm: "all" }), [], "mutually exclusive");
    assert.deepEqual(await names({ sets: "8" }), ["zqsac.com"]);
    const listed = (await browse.browsePool(browse.parseBrowse({ q: "zqsa", sort: "name" }), 50, false)).rows.map((r) => r.sets);
    assert.deepEqual(listed, ["1,6", "3,7", "8", "3,6", ""]);
    assert.equal((await browse.browsePool(browse.parseBrowse({ q: "zqsa", sets: "6,7" }))).total, 3);

    const block = (sets, setMode) => batches.countBlock(pool.normalizePoolFilters({ length: "5", sets, setMode }).filters, null, false);
    assert.equal(await block(["6"], "any"), 2);
    assert.equal(await block(["6", "7", "8"], "any"), 4);
    assert.equal(await block(["1", "6"], "all"), 1);
    assert.equal(await block(["6", "8"], "all"), 0);

    const { totals } = await pool.poolFacets();
    assert.deepEqual([totals.s6, totals.s7, totals.s8], [2, 1, 1]);
    const overview = await browse.poolOverview();
    const bySet = Object.fromEntries(overview.bySet.map((r) => [r.key, r]));
    assert.deepEqual([6, 7, 8].map((n) => bySet[n].total), [2, 1, 1]);
    assert.equal(bySet[6].only, 2, "'only' compares within the screening sets");
    const five = overview.byLength.find((r) => r.key === "5");
    assert.equal(five.perSet.length, ACTIVE_SETS.length);
    assert.deepEqual(five.perSet.slice(4), [2, 1, 1]);
    assert.equal(free.parseFreeQuery({ set: "7" }).set, 7);
  } finally {
    db.prepare("DELETE FROM pool WHERE name LIKE 'zqsa%'").run();
    cache.bumpData();
  }
});

test("import: files without set_6..8 default new rows to 0 and keep stored screening values", async () => {
  assert.equal(normalizeRow({ name: "zqsib" }, 1).set_6, null, "absent column");
  assert.equal(normalizeRow({ name: "zqsib", set_6: "0" }, 1).set_6, 0);
  assert.equal(normalizeRow({ name: "zqsib", set_8_forbidden: "1" }, 1).set_8, 1, "suffixed header");
  const f = path.join(process.env.DATA_DIR, "screen.csv");
  try {
    db.prepare("INSERT INTO pool (name, set_1, set_7, imported_at) VALUES ('zqsia.com', 1, 1, 1)").run();
    fs.writeFileSync(f, "name,set_1,set_3,import_tag\nzqsia,0,1,zqs-t\nzqsib,1,0,zqs-t\n");
    assert.equal((await importFile(f, "zqs")).error, undefined);
    const get = (n) => db.prepare("SELECT set_1, set_3, set_6, set_7, set_8 FROM pool WHERE name = ?").get(n);
    assert.deepEqual(get("zqsia.com"), { set_1: 0, set_3: 1, set_6: 0, set_7: 1, set_8: 0 }, "screening kept, other sets updated");
    assert.deepEqual(get("zqsib.com"), { set_1: 1, set_3: 0, set_6: 0, set_7: 0, set_8: 0 });

    fs.writeFileSync(f, "name,set_1,set_6,set_7,set_8\nzqsia,0,1,0,0\n");
    await importFile(f, "zqs");
    assert.deepEqual(get("zqsia.com"), { set_1: 0, set_3: 0, set_6: 1, set_7: 0, set_8: 0 }, "a file with the columns sets them");

    fs.writeFileSync(f, "name,set_1,ord\nzqsic,1,1\n");
    assert.equal((await free.importFreeCsv(f, "zqs-free")).upserted, 1);
    assert.deepEqual(get("zqsic.com"), { set_1: 1, set_3: 0, set_6: 0, set_7: 0, set_8: 0 });
    db.prepare("UPDATE pool SET set_8 = 1 WHERE name = 'zqsic.com'").run();
    await free.importFreeCsv(f, "zqs-free");
    assert.equal(get("zqsic.com").set_8, 1, "free re-import without the columns keeps them");
    fs.writeFileSync(f, "name,set_1,set_8,ord\nzqsic,1,0,1\n");
    await free.importFreeCsv(f, "zqs-free");
    assert.equal(get("zqsic.com").set_8, 0, "free import with the column sets it");
  } finally {
    db.prepare("DELETE FROM pool WHERE name LIKE 'zqsi%'").run();
    fs.rmSync(f, { force: true });
    cache.bumpData();
  }
});
