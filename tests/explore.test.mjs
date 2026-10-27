import { test } from "node:test";
import assert from "node:assert/strict";

const j = globalThis.__dvJiti;
const browse = await j.import("@/lib/pool-browse");
const { getSqlite } = await j.import("@/db");
const ins = getSqlite().prepare("INSERT OR IGNORE INTO pool (name, price_usd, imported_at) VALUES (?, 10, 1)");
for (const n of ["exa.com", "exab.com", "exabc.com", "exabd.com"]) ins.run(n);

test("explore: length facet, cached per dataset version; overview by length; lmin=lmax filter", async () => {
  const f1 = await browse.browseFacets();
  assert.ok(f1.lengths.some((l) => l.length === 5), JSON.stringify(f1.lengths));
  assert.equal(await browse.browseFacets(), f1, "same object while dataset version unchanged");
  const { byLength } = await browse.poolOverview();
  assert.deepEqual(byLength.map((r) => Number(r.key)), f1.lengths.map((l) => l.length));
  const q = browse.parseBrowse({ lmin: "5", lmax: "5" });
  const res = await browse.browsePool(q);
  assert.ok(res.rows.length > 0 && res.rows.every((r) => r.name.length === 9));
});
