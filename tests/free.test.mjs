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

test("free_names v12: cf/price columns, shape + cf filters, register links, voter tab names-only (off by default)", async () => {
  const settings = await j.import("@/lib/settings");
  const f = path.join(process.env.DATA_DIR, "free-cf.csv");
  fs.writeFileSync(f, "name,length,set_1,set_2,set_3,set_4,set_5,set4_part,shape,cf_free,cf_checked_at,reg_price_usd,reg_registrar\nwvq,3,1,0,0,0,0,none,CCC,1,2026-10-20T10:00:00Z,10.44,cloudflare\nwvqa,4,1,0,0,0,0,none,CCCV,0,1793000000,,\nwvqb,4,1,0,0,0,0,none,CCCC,,,,\n");
  const r = await free.importFreeCsv(f, "cf-test");
  assert.equal(r.upserted, 3);
  const row = getSqlite().prepare("SELECT cf_free, cf_checked_at, reg_price_usd, reg_registrar FROM free_names WHERE name='wvq.com'").get();
  assert.deepEqual({ ...row }, { cf_free: 1, cf_checked_at: Date.parse("2026-10-20T10:00:00Z"), reg_price_usd: 10.44, reg_registrar: "cloudflare" });
  assert.equal(getSqlite().prepare("SELECT cf_checked_at t FROM free_names WHERE name='wvqa.com'").get().t, 1793000000000, "epoch seconds → ms");
  // A re-import without the cf columns keeps the stored price.
  fs.writeFileSync(f, "name,length,set_1\nwvq,3,1\n");
  await free.importFreeCsv(f, null);
  assert.equal(getSqlite().prepare("SELECT reg_price_usd p FROM free_names WHERE name='wvq.com'").get().p, 10.44);
  assert.deepEqual(free.browseFree(free.parseFreeQuery({ cf: "1", q: "wvq" })).rows.map((x) => x.name), ["wvq.com"]);
  assert.deepEqual(free.browseFree(free.parseFreeQuery({ len: "4", shape: "cccc" })).rows.map((x) => x.name), ["wvqb.com"]);
  assert.ok(free.freeShapeCounts(4).some((s) => s.shape === "CCCV"));
  const links = free.registerLinks("wvq.com");
  assert.match(links.cloudflare, /cloudflare\.com.*wvq\.com/);
  assert.equal(links.namecheap, "https://www.namecheap.com/domains/registration/results/?domain=wvq.com");
  assert.equal(links.godaddy, "https://www.godaddy.com/domainsearch/find?domainToCheck=wvq.com");
  assert.equal(settings.getVoterFreeTab(), false, "voter tab off by default");
  settings.setVoterFreeTab(true, 1);
  assert.equal(settings.getVoterFreeTab(), true);
  settings.setVoterFreeTab(false, 1);
  const v = free.browseFreeNamesOnly({ len: 4, page: 1 });
  assert.ok(v.names.every((n) => typeof n === "string"), "names only");
  assert.ok(v.names.includes("wvqb.com"));
});
