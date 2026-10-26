import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const j = globalThis.__dvJiti;
const { getSqlite } = await j.import("@/db");
const { importFile, normalizeRow, deleteByImportTag } = await j.import("@/lib/pool-import");
const db = getSqlite();

test("v9 migration applied and additive", () => {
  const v = db.prepare("SELECT max(version) v FROM schema_migrations").get().v;
  assert.ok(v >= 9);
  const cols = db.prepare("PRAGMA table_xinfo(pool)").all().map((c) => c.name);
  for (const c of ["shape", "set4_part", "import_tag", "best_currency", "name_len"]) assert.ok(cols.includes(c), c);
});

test("normalizeRow: 3/4/5 letters, length check, precomputed price_usd, tag", () => {
  const now = 1;
  assert.equal(normalizeRow({ name: "abc", length: "3" }, now).name, "abc.com");
  assert.equal(normalizeRow({ name: "abcde.com", length: "5" }, now).name, "abcde.com");
  assert.equal(normalizeRow({ name: "abcd", length: "5" }, now), null, "length mismatch skipped");
  assert.equal(normalizeRow({ name: "ab_c" }, now), null, "bad chars skipped");
  assert.equal(normalizeRow({ name: "abc.net" }, now), null, "only .com");
  const r = normalizeRow({ name: "bbac", lp_price: "900", lp_currency: "eur", price_usd: "972", import_tag: "4L-gap-2026-10-26", set4_part: "MAIN", shape: "ccvc", best_currency: "eur" }, now);
  assert.equal(r.price_usd, 972);
  assert.equal(r.lp_currency, "EUR");
  assert.equal(r.import_tag, "4L-gap-2026-10-26");
  assert.equal(r.set4_part, "main");
  assert.equal(r.shape, "CCVC");
  assert.equal(normalizeRow({ name: "bbac", lp_price: "9", lp_currency: "XYZ", price_usd: "" }, now).price_usd, null, "other currency stays NULL");
  assert.equal(normalizeRow({ name: "bbac", lp_price: "9", lp_currency: "USD" }, now).price_usd, 9, "legacy export: USD passthrough");
  assert.equal(normalizeRow({ name: "bbac", lp_price: "9", lp_currency: "EUR" }, now).price_usd, null, "legacy export: no conversion");
});

test("CSV import of mixed lengths + tag rollback", async () => {
  const f = path.join(process.env.DATA_DIR, "mix.csv");
  fs.writeFileSync(f, "name,length,set_1,set_2,set_3,set_4,set_5,set4_part,shape,import_tag,lp_price,lp_currency,price_usd\n" +
    "kia,3,1,0,0,0,0,none,CVV,t1,100,USD,100\nbbac,4,0,0,0,1,0,main,CCVC,t1,50,GBP,63\nnavid,5,0,0,1,0,0,none,CVCVC,t1,,,\nbad!,4,0,0,0,1,0,,,t1,,,\n");
  const res = await importFile(f, "test");
  assert.equal(res.error, undefined);
  assert.equal(res.rowsUpserted, 3);
  assert.equal(res.rowsSkipped, 1);
  const lens = db.prepare("SELECT name_len l FROM pool WHERE import_tag='t1' ORDER BY l").all().map((r) => r.l);
  assert.deepEqual(lens, [3, 4, 5]);
  assert.equal(deleteByImportTag("t1"), 3);
});
