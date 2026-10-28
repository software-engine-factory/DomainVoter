import { test } from "node:test";
import assert from "node:assert/strict";

const j = globalThis.__dvJiti;
const { getSqlite } = await j.import("@/db");
const { createRoundFromPool } = await j.import("@/lib/rounds");
const pool = await j.import("@/lib/pool");
const supp = await j.import("@/lib/supplements");
const db = getSqlite();
const TAG = "4L-gap-test";

test("option (b): gap names appended to existing round, core untouched, idempotent, removable", async () => {
  const ins = db.prepare("INSERT INTO pool (name, price_usd, best_price, best_currency, import_tag, imported_at) VALUES (?, 5, 5, ?, ?, 1)");
  for (const n of ["qxaa", "qxab", "qxac", "qxad"]) ins.run(`${n}.com`, "USD", null);
  const f = pool.normalizePoolFilters({ length: "4", order: "random", q: "qx" }).filters;
  const { id } = await createRoundFromPool("supp-core", f, "seed-1");
  const coreBefore = db.prepare("SELECT id, position, name FROM domains WHERE round_id = ? ORDER BY position").all(id);
  assert.ok(coreBefore.length >= 4);
  const d0 = coreBefore[0].id;
  db.prepare("INSERT INTO views (round_id, domain_id, user_id, viewed_at) VALUES (?, ?, 1, 1)").run(id, d0);

  for (const n of ["qxba", "qxbb", "qxbc"]) ins.run(`${n}.com`, "EUR", TAG);
  ins.run("qxbcd.com", "EUR", TAG); // 5 letters: wrong length for this round

  const plan = (await supp.planSupplement(TAG)).find((p) => p.roundId === id);
  assert.deepEqual([...plan.add].sort(), ["qxba.com", "qxbb.com", "qxbc.com"]);
  const r = await supp.applySupplement(TAG, null, [id]);
  assert.equal(r.names, 3);

  const after = db.prepare("SELECT id, position, name, segment, currency FROM domains WHERE round_id = ? ORDER BY position").all(id);
  assert.deepEqual(after.filter((d) => d.segment == null).map(({ id, position, name }) => ({ id, position, name })), coreBefore, "core intact");
  const tail = after.filter((d) => d.segment === TAG);
  assert.deepEqual(tail.map((d) => d.position), [coreBefore.length + 1, coreBefore.length + 2, coreBefore.length + 3]);
  assert.ok(tail.every((d) => d.currency === "EUR"), "original currency kept");
  assert.equal((await supp.planSupplement(TAG)).find((p) => p.roundId === id).skip, "done");
  assert.equal((await supp.applySupplement(TAG, null, [id])).names, 0, "idempotent");

  const lr = db.prepare("SELECT COUNT(*) n FROM views WHERE round_id = ?").get(id).n;
  assert.equal(lr, 1, "views untouched");

  db.prepare("INSERT INTO views (round_id, domain_id, user_id, viewed_at) VALUES (?, ?, 1, 1)").run(id, tail[0].id);
  assert.equal(supp.removeSupplement(TAG), 2, "seen supplement row is kept");
  assert.ok((await supp.importTags()).some((t) => t.tag === TAG && t.lmin === 4 && t.lmax === 5));
});

test("gap names outside the round's set filter: skipped as 'filter' unless match = length", async () => {
  const ins = db.prepare("INSERT INTO pool (name, price_usd, set_1, set_4, import_tag, imported_at) VALUES (?, NULL, ?, ?, ?, 1)");
  for (const n of ["wqaa", "wqab"]) ins.run(`${n}.com`, 1, 0, null);
  const f = pool.normalizePoolFilters({ length: "4", sets: ["1"], q: "wq" }).filters;
  const { id } = await createRoundFromPool("supp-sets", f, null);
  for (const n of ["wqba", "wqbb", "wqbc"]) ins.run(`${n}.com`, 0, 1, "gap-set4");
  const strict = (await supp.planSupplement("gap-set4")).find((p) => p.roundId === id);
  assert.equal(strict.add.length, 0);
  assert.equal(strict.skip, "filter");
  assert.equal(strict.outside, 3);
  const loose = (await supp.planSupplement("gap-set4", "length")).find((p) => p.roundId === id);
  assert.equal(loose.add.length, 3);
  assert.equal((await supp.applySupplement("gap-set4", null, [id], "length")).names, 3);
});
