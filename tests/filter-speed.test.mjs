import { test } from "node:test";
import assert from "node:assert/strict";

const j = globalThis.__dvJiti;
const { getSqlite } = await j.import("@/db");
const batches = await j.import("@/lib/batches");
const pool = await j.import("@/lib/pool");
const browse = await j.import("@/lib/pool-browse");
const cache = await j.import("@/lib/data-cache");
const rounds = await j.import("@/lib/rounds");
const { materializeDomains } = await j.import("@/lib/domain-catalog");
const db = getSqlite();

async function allBrowseRows(input) {
  const rows = [];
  let query = { ...input };
  for (let page = 1; page < 1000; page++) {
    const result = await browse.browsePool(browse.parseBrowse({ ...query, page: String(page) }), 50, false);
    rows.push(...result.rows.map((row) => row.name));
    if (!result.hasMore) break;
    query = { ...input, cursor: browse.browseCursorFromRow(browse.parseBrowse(input), result.rows.at(-1)) };
  }
  return rows;
}

test("capped batch count stops at the cap and remains exact below it", async () => {
  const names = Array.from({ length: 6 }, (_, i) => `ffcap${String(i).padStart(3, "0")}.com`);
  const insert = db.prepare("INSERT OR IGNORE INTO pool (name, imported_at, avail) VALUES (?, 0, 'free')");
  try {
    db.transaction(() => names.forEach((name) => insert.run(name)))();
    cache.bumpData();
    const filters = pool.normalizePoolFilters({ length: "8", avail: "free" }).filters;
    assert.equal(await batches.countBlock(filters, 3, false), 3);
    assert.equal(await batches.countBlock(filters, 20, false), 6);
    assert.equal(await batches.countBlock(filters, null, false), 6);
  } finally {
    db.prepare("DELETE FROM pool WHERE name LIKE 'ffcap___.com'").run();
    cache.bumpData();
  }
});

test("browse count cache invalidates when the pool data version changes", async () => {
  const insert = db.prepare("INSERT OR IGNORE INTO pool (name, imported_at, avail) VALUES (?, 0, 'free')");
  try {
    insert.run("ffcache000.com");
    cache.bumpData();
    const query = browse.parseBrowse({ lmin: "10", lmax: "10", av: "free" });
    const before = (await browse.browsePool(query)).total;
    insert.run("ffcache001.com");
    cache.bumpData();
    const after = (await browse.browsePool(query)).total;
    assert.equal(after, before + 1);
  } finally {
    db.prepare("DELETE FROM pool WHERE name LIKE 'ffcache___.com'").run();
    cache.bumpData();
  }
});

test("simple length and availability counts use trigger-maintained totals", async () => {
  const names = ["fftotals001.com", "fftotals002.com", "fftotals003.com"];
  const insert = db.prepare("INSERT OR IGNORE INTO pool (name, imported_at, avail) VALUES (?, 0, ?)");
  try {
    db.transaction(() => names.forEach((name, i) => insert.run(name, i === 0 ? "sale" : "free")))();
    cache.bumpData();
    for (const query of [{}, { lmin: "11", lmax: "11" }, { lmin: "11", lmax: "11", av: "free" }, { av: "sale" }]) {
      const q = browse.parseBrowse(query);
      const fast = browse.browseCountSql(q);
      assert.ok(fast, "simple length/availability count should use the summary table");
      const actual = (await browse.countBrowse(q));
      const expectedWhere = browse.browseWhere(q);
      const expected = db.prepare(`SELECT COUNT(*) AS n FROM pool p ${expectedWhere.sql}`).get(...expectedWhere.params).n;
      assert.equal(actual, expected);
    }
    db.prepare("UPDATE pool SET name = ?, avail = 'sale' WHERE name = ?").run("fftotal999.com", names[2]);
    for (const query of [{ lmin: "10", lmax: "10" }, { av: "sale" }]) {
      const q = browse.parseBrowse(query);
      const expectedWhere = browse.browseWhere(q);
      const expected = db.prepare(`SELECT COUNT(*) AS n FROM pool p ${expectedWhere.sql}`).get(...expectedWhere.params).n;
      assert.equal(await browse.countBrowse(q), expected);
    }
    assert.equal(browse.browseCountSql(browse.parseBrowse({ q: "fftotals" })), null);
  } finally {
    db.prepare("DELETE FROM pool WHERE name LIKE 'fftotals___.com' OR name = 'fftotal999.com'").run();
    cache.bumpData();
  }
});

test("used and in-round counts invalidate on physical and compact membership changes", async () => {
  const names = ["ffcatcount001.com", "ffcatcount002.com", "ffcatcount003.com"];
  const insert = db.prepare("INSERT OR IGNORE INTO pool (name, imported_at, avail) VALUES (?, 0, 'free')");
  let physicalRound = 0;
  let compactRound = 0;
  try {
    db.transaction(() => names.forEach((name) => insert.run(name)))();
    cache.bumpData();
    const usedQuery = browse.parseBrowse({ q: "ffcatcount", used: "never" });
    let physicalQuery;
    assert.equal(await browse.countBrowse(usedQuery), 3);

    const projectionPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT ${browse.BROWSE_ROW_SELECT} FROM pool p WHERE p.name=? LIMIT 1`).all(names[0]);
    assert.ok(projectionPlan.some((row) => row.detail.includes("domains_name_idx") && row.detail.includes("name=?")), JSON.stringify(projectionPlan));
    assert.ok(projectionPlan.some((row) => row.detail.includes("selection_items_name_idx") && row.detail.includes("name=?")), JSON.stringify(projectionPlan));
    assert.ok(!projectionPlan.some((row) => /AUTOMATIC|SCAN domains|SCAN i\b|SCAN rr\b|domain_catalog/i.test(row.detail)), JSON.stringify(projectionPlan));
    for (const filters of [{ used: "never" }, { inr: "1" }]) {
      const where = browse.browseWhere(browse.parseBrowse(filters));
      const membershipPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT p.name FROM pool p ${where.sql} LIMIT 1`).all(...where.params);
      assert.ok(!membershipPlan.some((row) => /AUTOMATIC|SCAN domain_catalog|SCAN domains|SCAN i\b|SCAN rr\b/i.test(row.detail)), JSON.stringify(membershipPlan));
    }

    physicalRound = rounds.createRound({
      title: "Filter count physical membership fixture",
      parentRoundId: null,
      filterJson: null,
      sortMode: "original",
      rows: [{ name: names[0], price: null, currency: null, poolName: names[0], isPremium: 0 }],
    });
    physicalQuery = browse.parseBrowse({ q: "ffcatcount", inr: String(physicalRound) });
    assert.equal(await browse.countBrowse(usedQuery), 2);
    assert.equal(await browse.countBrowse(physicalQuery), 1);
    assert.ok(rounds.deleteRound(physicalRound));
    physicalRound = 0;
    assert.equal(await browse.countBrowse(usedQuery), 3);
    assert.equal(await browse.countBrowse(physicalQuery), 0);

    compactRound = Number(db.prepare(`INSERT INTO rounds(title,status,created_at,creation_job_id)
      VALUES ('Filter count compact fixture','open',0,'filter-count-pending')`).run().lastInsertRowid);
    const selection = Number(db.prepare("INSERT INTO domain_selections DEFAULT VALUES").run().lastInsertRowid);
    db.prepare("INSERT INTO selection_items(selection_id,position,name,price,currency) VALUES (?,1,?,10,'USD')").run(selection, names[1]);
    db.prepare(`INSERT INTO round_domain_ranges(round_id,selection_id,start_position,end_position,len_min,len_max,label_length)
      VALUES (?,?,1,1,13,13,13)`).run(compactRound, selection);
    assert.equal(await browse.countBrowse(usedQuery), 3, "hidden compact round does not count as used");
    const compactQuery = browse.parseBrowse({ q: "ffcatcount", inr: String(compactRound) });
    assert.equal(await browse.countBrowse(compactQuery), 0, "hidden compact round is excluded");

    db.prepare("UPDATE rounds SET creation_job_id=NULL WHERE id=?").run(compactRound);
    assert.equal(await browse.countBrowse(usedQuery), 2, "publication invalidates cached used count");
    assert.equal(await browse.countBrowse(compactQuery), 1, "publication invalidates cached in-round count");
    assert.equal((await browse.browsePool(compactQuery, 50, false)).rows[0].rounds, 1);

    const virtual = db.prepare("SELECT id FROM domain_catalog WHERE round_id=? AND id<0").get(compactRound);
    assert.ok(virtual);
    const revisionBeforeHydration = db.prepare("SELECT n FROM catalog_revision WHERE id=1").get().n;
    materializeDomains(compactRound, [virtual.id]);
    assert.equal(db.prepare("SELECT n FROM catalog_revision WHERE id=1").get().n, revisionBeforeHydration,
      "hydrating a negative virtual ID does not change membership revision");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM domain_catalog WHERE round_id=?").get(compactRound).n, 1);
    assert.equal(await browse.countBrowse(usedQuery), 2);
    assert.equal(await browse.countBrowse(compactQuery), 1);
    assert.equal((await browse.browsePool(compactQuery, 50, false)).rows[0].rounds, 1,
      "the rounds scalar UNION deduplicates virtual membership when its negative ID is hydrated");

    assert.ok(rounds.deleteRound(compactRound));
    compactRound = 0;
    assert.equal(await browse.countBrowse(usedQuery), 3, "deleting a compact round invalidates used count");
    assert.equal(await browse.countBrowse(compactQuery), 0, "deleting a compact round invalidates in-round count");
  } finally {
    if (physicalRound) rounds.deleteRound(physicalRound);
    if (compactRound) rounds.deleteRound(compactRound);
    db.prepare("DELETE FROM pool WHERE name LIKE 'ffcatcount___.com'").run();
    cache.bumpData();
  }
});

test("name cursor pages match the independent sorted result, including reverse paging", async () => {
  const names = ["ffcursor003.com", "ffcursor001.com", "ffcursor002.com"];
  const insert = db.prepare("INSERT OR IGNORE INTO pool (name, imported_at, avail) VALUES (?, 0, 'free')");
  try {
    db.transaction(() => names.forEach((name) => insert.run(name)))();
    cache.bumpData();
    const expected = db.prepare("SELECT name FROM pool WHERE name LIKE '%ffcursor%' ORDER BY name").all().map((row) => row.name);
    const base = { q: "ffcursor" };
    const first = await browse.browsePool(browse.parseBrowse(base), 2);
    assert.deepEqual(first.rows.map((row) => row.name), expected.slice(0, 2));
    assert.equal(first.hasMore, true);
    const second = await browse.browsePool(browse.parseBrowse({ ...base, page: "2", cursor: first.rows.at(-1).name }), 2);
    assert.deepEqual(second.rows.map((row) => row.name), expected.slice(2));
    const previous = await browse.browsePool(browse.parseBrowse({ ...base, page: "1", cursor: second.rows[0].name, direction: "prev" }), 2);
    assert.deepEqual(previous.rows.map((row) => row.name), expected.slice(0, 2));
  } finally {
    db.prepare("DELETE FROM pool WHERE name LIKE 'ffcursor___.com'").run();
    cache.bumpData();
  }
});

test("price cursors preserve the full null, price and name sort tuple in both directions", async () => {
  const rows = [["ffprice001.com", 2], ["ffprice002.com", 2], ["ffprice003.com", 1], ["ffprice004.com", null], ["ffprice005.com", null], ["ffprice006.com", null]];
  const insert = db.prepare("INSERT OR IGNORE INTO pool (name, price_usd, imported_at, avail) VALUES (?, ?, 0, 'free')");
  try {
    db.transaction(() => rows.forEach(([name, price]) => insert.run(name, price)))();
    cache.bumpData();
    for (const sort of ["price_asc", "price_desc"]) {
      const direction = sort === "price_asc" ? "ASC" : "DESC";
      const expected = db.prepare(`SELECT name FROM pool WHERE name LIKE '%ffprice%' ORDER BY price_usd IS NULL, price_usd ${direction}, name`).all().map((row) => row.name);
      const base = { q: "ffprice", sort };
      const first = await browse.browsePool(browse.parseBrowse(base), 2);
      assert.deepEqual(first.rows.map((row) => row.name), expected.slice(0, 2));
      const cursor = browse.browseCursorFromRow(browse.parseBrowse(base), first.rows.at(-1));
      const second = await browse.browsePool(browse.parseBrowse({ ...base, page: "2", cursor }), 2);
      assert.deepEqual(second.rows.map((row) => row.name), expected.slice(2,4));
      // A cursor defines the boundary independently of the cosmetic page number, including among unpriced rows.
      const nullCursor=browse.browseCursorFromRow(browse.parseBrowse(base),second.rows.at(-1));
      const afterNull=await browse.browsePool(browse.parseBrowse({...base,page:"1",cursor:nullCursor}),2);
      assert.deepEqual(afterNull.rows.map(row=>row.name),expected.slice(4));
      const previous = await browse.browsePool(browse.parseBrowse({ ...base, page: "1", cursor: browse.browseCursorFromRow(browse.parseBrowse(base), second.rows[0]), direction: "prev" }), 2);
      assert.deepEqual(previous.rows.map((row) => row.name), expected.slice(0, 2));
    }
  } finally {
    db.prepare("DELETE FROM pool WHERE name LIKE 'ffprice___.com'").run();
    cache.bumpData();
  }
});

test("full Explore price projection uses the length-prefixed sort indexes without a temp sort", () => {
  for (const [sort, index] of [["price_asc", "pool_len_price_name_idx"], ["price_desc", "pool_len_price_desc_name_idx"]]) {
    const q = browse.parseBrowse({ lmin: "5", lmax: "5", sort });
    const where = browse.browseWhere(q), order = browse.orderSql(q);
    assert.match(where.sql, /p\.name_len = \?/);
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT ${browse.BROWSE_ROW_SELECT} FROM pool p ${where.sql} ORDER BY ${order.sql} LIMIT 51 OFFSET 0`).all(...where.params, ...order.params);
    assert.ok(plan.some((row) => row.detail.includes(index)), JSON.stringify(plan));
    // The small per-name UNION may sort its few round IDs. The outer pool must not sort millions of rows.
    assert.ok(!plan.some((row) => row.parent === 0 && row.detail.includes("USE TEMP B-TREE FOR ORDER BY")), JSON.stringify(plan));
  }
});

test("substring and exact position filters retain LIKE results", async () => {
  const names = ["ffabx.com", "zzabc.com", "xaxbq.com", "xaabq.com", "a12bc.com", "zz12z.com", "zzzzz.ab", "zzzzz.xn--p1ai", "éaébz.com"];
  const insert = db.prepare("INSERT OR IGNORE INTO pool (name, imported_at, avail) VALUES (?, 0, 'free')");
  try {
    db.transaction(() => names.forEach((name) => insert.run(name)))();
    cache.bumpData();
    const fixtureMatch = (term) => {
      const where = browse.browseWhere(browse.parseBrowse({ q: term }));
      const inNames = names.map(() => "?").join(",");
      return db.prepare(`SELECT p.name FROM pool p ${where.sql} AND p.name IN (${inNames}) ORDER BY p.name`).all(...where.params, ...names).map((row) => row.name);
    };
    for (const term of ["ab", "abc", "code", "zzz", "xn--", "p1", "12"]) {
      const expected = db.prepare("SELECT name FROM pool WHERE name LIKE ? ORDER BY name").all(`%${term}%`).map((row) => row.name);
      assert.deepEqual(await allBrowseRows({ q: term }), expected, `query ${term}`);
    }
    for (const term of ["co", "om", "com", ".c"]) {
      const expected = db.prepare("SELECT name FROM pool WHERE name IN (" + names.map(() => "?").join(",") + ") AND name LIKE ? ORDER BY name").all(...names, `%${term}%`).map((row) => row.name);
      assert.deepEqual(fixtureMatch(term), expected, `fixture parity for ${term}`);
    }
    const indexedWhere = browse.browseWhere(browse.parseBrowse({ q: "ab" }));
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT p.name FROM pool p ${indexedWhere.sql} ORDER BY p.name LIMIT 50`).all(...indexedWhere.params);
    assert.ok(plan.some((row) => row.detail.includes("SEARCH p USING PRIMARY KEY")), JSON.stringify(plan));
    const suffixWhere = browse.browseWhere(browse.parseBrowse({ q: "co" }));
    const suffixPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT p.name FROM pool p ${suffixWhere.sql}`).all(...suffixWhere.params);
    assert.ok(suffixPlan.some((row) => row.detail.includes("pool_len_suffix_idx") && row.detail.includes("<expr>=?")), JSON.stringify(suffixPlan));

    const patternExpected = db.prepare("SELECT name FROM pool WHERE name_len = 5 AND name LIKE '_a_b_%' ORDER BY name").all().map((row) => row.name);
    const pattern = await allBrowseRows({ pat: "_a_b_", exact: "1" });
    assert.deepEqual(pattern, patternExpected);
    const indexedPatternWhere = browse.browseWhere(browse.parseBrowse({ pat: "_a_b_", exact: "1" }));
    const patternPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT p.name FROM pool p ${indexedPatternWhere.sql}`).all(...indexedPatternWhere.params);
    assert.ok(patternPlan.some((row) => row.detail.includes("pool_pos")), JSON.stringify(patternPlan));
  } finally {
    db.prepare(`DELETE FROM pool WHERE name IN (${names.map(() => "?").join(",")})`).run(...names);
    cache.bumpData();
  }
});
