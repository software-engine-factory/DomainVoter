import { test } from "node:test";
import assert from "node:assert/strict";

const j = globalThis.__dvJiti;
const ro = await j.import("@/lib/ro");
const cache = await j.import("@/lib/data-cache");
const { warmCaches } = await j.import("@/lib/warm");
const { getSqlite } = await j.import("@/db");

const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(check(), "timed out");
};
// A cached value is returned without calling compute; a miss calls it.
const isCached = async (key) => {
  let computed = false;
  await cache.cachedAsync(key, async () => ((computed = true), null));
  return !computed;
};

test("warm-up: skipped for inline reads, fills the pool caches with threaded reads, refills after a pool change", async () => {
  const g = globalThis;
  const saved = g.dvReader;
  try {
    g.dvReader = ro.inlineReader();
    cache.bumpData();
    warmCaches();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(g.dvWarm?.running ?? false, false, "inline reads must not warm (would block the main thread)");
    assert.equal(await isCached("poolOverview"), false);

    getSqlite().prepare("INSERT OR IGNORE INTO pool (name, price_usd, imported_at) VALUES ('warm1.com', 5, 1)").run();
    g.dvReader = ro.workerReader(1);
    cache.bumpData();
    warmCaches();
    await until(() => g.dvWarm && !g.dvWarm.running);
    for (const key of ["poolLengthCounts", "poolFacets", "browseFacets", "poolOverview", "setSamples:4", "importTags"]) {
      assert.ok(await isCached(key), `${key} warmed`);
    }

    cache.bumpData(); // an app write path that changes the pool: caches drop, warm-up runs again
    await new Promise((r) => setTimeout(r, 300));
    await until(() => !g.dvWarm.running);
    assert.ok(await isCached("poolOverview"), "refilled after bumpData");
  } finally {
    g.dvReader = saved;
    cache.bumpData();
  }
});
