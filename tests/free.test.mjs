import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const j = globalThis.__dvJiti;
const free = await j.import("@/lib/free-names");
const { getSqlite } = await j.import("@/db");

test("free_names: v10 table, CSV import (3/5 letters), browse by length/set, admin-only (not in pool)", async () => {
  const f = path.join(process.env.DATA_DIR, "free.csv");
  fs.writeFileSync(f, "name,length,set_1,set_2,set_3,set_4,set_5,set4_part,shape,ord\nqzx,3,1,0,0,0,0,none,CCC,2\nqzxa,4,0,0,0,1,0,main,CCCV,1\nqzxab,5,0,0,1,0,0,none,CCCVC,7\nbad!,4,0,0,0,0,0,,,\nqzxbb,4,0,0,0,0,0,,,\n");
  const before = getSqlite().prepare("SELECT COUNT(*) n FROM pool").get().n;
  const r = await free.importFreeCsv(f, "free-test");
  assert.equal(r.upserted, 3);
  assert.equal(r.skipped, 2, "bad chars + declared length mismatch");
  assert.equal(getSqlite().prepare("SELECT COUNT(*) n FROM pool").get().n, before, "pool untouched");
  const counts = Object.fromEntries(free.freeLengthCounts().map((c) => [c.length, c.count]));
  assert.deepEqual(counts, { 3: 1, 4: 1, 5: 1 });
  const b = free.browseFree(free.parseFreeQuery({ len: "5" }));
  assert.equal(b.total, 1);
  assert.equal(b.rows[0].name, "qzxab.com");
  assert.equal(b.rows[0].shape, "CCCVC");
  assert.equal(free.browseFree(free.parseFreeQuery({ set: "4" })).rows[0].name, "qzxa.com");
  const again = await free.importFreeCsv(f, "other");
  assert.equal(getSqlite().prepare("SELECT import_tag t FROM free_names WHERE name='qzx.com'").get().t, "free-test", "first tag kept");
  assert.equal(again.upserted, 3);
});

test("free_names v12: price columns, non-registrable rows rejected at import, register links, voter tab off by default", async () => {
  const settings = await j.import("@/lib/settings");
  const reg = await j.import("@/lib/register-links");
  const f = path.join(process.env.DATA_DIR, "free-cf.csv");
  fs.writeFileSync(f, "name,length,set_1,set_2,set_3,set_4,set_5,set4_part,shape,cf_free,cf_checked_at,reg_price_usd,reg_registrar\nwvq,3,1,0,0,0,0,none,CCC,1,2026-10-20T10:00:00Z,10.44,cloudflare\nwvqa,4,1,0,0,0,0,none,CCCV,0,1793000000,,\nwvqb,4,1,0,0,0,0,none,CCCC,,1793000000,,\nwvqc,4,1,0,0,0,0,none,CCCC,taken,,,\n");
  const r = await free.importFreeCsv(f, "cf-test");
  assert.equal(r.upserted, 2, "only registrable rows stored");
  assert.equal(r.skipped, 2, "cf_free=0 / taken rejected");
  assert.equal(getSqlite().prepare("SELECT COUNT(*) n FROM free_names WHERE name IN ('wvqa.com','wvqc.com')").get().n, 0);
  const cols = getSqlite().prepare("PRAGMA table_info(free_names)").all().map((c) => c.name);
  assert.ok(!cols.includes("cf_free"), "no taken/free flag column");
  const row = getSqlite().prepare("SELECT cf_checked_at, reg_price_usd, reg_registrar FROM free_names WHERE name='wvq.com'").get();
  assert.deepEqual({ ...row }, { cf_checked_at: Date.parse("2026-10-20T10:00:00Z"), reg_price_usd: 10.44, reg_registrar: "cloudflare" });
  assert.equal(getSqlite().prepare("SELECT cf_checked_at t FROM free_names WHERE name='wvqb.com'").get().t, 1793000000000, "epoch seconds → ms");
  fs.writeFileSync(f, "name,length,set_1\nwvq,3,1\n");
  await free.importFreeCsv(f, null);
  assert.equal(getSqlite().prepare("SELECT reg_price_usd p FROM free_names WHERE name='wvq.com'").get().p, 10.44, "re-import keeps price");
  const links = Object.fromEntries(reg.registerLinks("wvq.com").map((l) => [l.key, l.href]));
  assert.match(links.cloudflare, /cloudflare\.com.*wvq\.com/);
  assert.equal(links.namecheap, "https://www.namecheap.com/domains/registration/results/?domain=wvq.com");
  assert.equal(links.godaddy, "https://www.godaddy.com/domainsearch/find?domainToCheck=wvq.com");
  assert.equal(settings.getVoterFreeTab(), false, "voter tab off by default");
  settings.setVoterFreeTab(true, 1);
  assert.equal(settings.getVoterFreeTab(), true);
  settings.setVoterFreeTab(false, 1);
  const v = free.browseFreeForVoters({ len: 3, page: 1 });
  assert.deepEqual(v.rows.find((x) => x.name === "wvq.com"), { name: "wvq.com", regPrice: 10.44 });
});

test("pool import rejects non-purchasable rows (status taken/sold)", async () => {
  const pi = await j.import("@/lib/pool-import");
  assert.equal(pi.normalizeRow({ name: "zzq", status: "taken" }, 1), null);
  assert.equal(pi.normalizeRow({ name: "zzq", status: "sold" }, 1), null);
  assert.ok(pi.normalizeRow({ name: "zzq", status: "for_sale" }, 1));
});
