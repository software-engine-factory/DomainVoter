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
