import { getSqlite } from "@/db";
import { cached, cachedCount } from "@/lib/data-cache";
import { poolLengthCounts } from "@/lib/pool";
import { normalizePattern, normalizeQuery, patternActive, PATTERN_MAX } from "@/lib/vote-view";
import { ACTIVE_SETS, normalizeSetIds } from "@/lib/sets";

/**
 * Admin pool explorer: the 13 exploration filters over the whole for-sale pool.
 * Server-side, URL state, paginated. Columns price_source / has_price / name_len come from migration v6.
 */
type Params = Record<string, string | string[] | undefined>;

export const BROWSE_SORTS = ["name", "price_asc", "price_desc", "votes", "random"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];
export const NONE = "__none__";
export const BROWSE_PAGE_SIZE = 50;

export type BrowseQuery = {
  hp: "" | "yes" | "no"; // 1 has price
  src: string[]; // 2 price source (NONE = no price)
  cur: "" | "usd" | "other" | "none"; // 3 currency
  min: number | null; // 4 USD range
  max: number | null;
  sets: number[]; // 5 sets
  sm: "any" | "all";
  ev: "" | "sale_page" | "nameserver"; // 6 sale evidence
  cls: string; // 7 NS class
  prov: string; // 7 parking provider
  link: "" | "yes" | "no"; // 8 has sale link
  q: string; // 9 text
  pat: string; // 9 letter positions
  exact: boolean;
  lmin: number | null; // 10 length
  lmax: number | null;
  used: "" | "never" | "used"; // 11 used in rounds
  inr: number | null; // 11 in round #
  eng: "" | "seen" | "voted" | "bookmarked"; // 12 engagement
  sort: BrowseSort; // 13 sort
  seed: string;
  page: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
const pick = <T extends string>(v: string, allowed: readonly T[], fallback: T) => ((allowed as readonly string[]).includes(v) ? (v as T) : fallback);
/** Accepts Latin or Persian digits and ٬ / , separators. */
export function parseGrouped(raw: string): number | null {
  const ascii = raw
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٬,\s]/g, "");
  if (!ascii) return null;
  const n = Number(ascii);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const posInt = (v: string) => {
  const n = parseGrouped(v);
  return n != null && Number.isInteger(n) && n > 0 ? n : null;
};

export function parseBrowse(params: Params): BrowseQuery {
  const exact = ["1", "on", "true"].includes(first(params.exact));
  let min = parseGrouped(first(params.min));
  let max = parseGrouped(first(params.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  let lmin = posInt(first(params.lmin));
  let lmax = posInt(first(params.lmax));
  if (lmin != null && lmax != null && lmin > lmax) [lmin, lmax] = [lmax, lmin];
  const pat = normalizePattern(first(params.pat).slice(0, PATTERN_MAX), exact);
  return {
    hp: pick(first(params.hp), ["yes", "no"] as const, "" as never) || "",
    src: [...new Set(many(params.src).map((s) => s.toLowerCase().slice(0, 60)))].slice(0, 20),
    cur: pick(first(params.cur), ["usd", "other", "none"] as const, "" as never) || "",
    min,
    max,
    sets: normalizeSetIds(many(params.sets).flatMap((v) => String(v).split(","))),
    sm: first(params.sm) === "all" ? "all" : "any",
    ev: pick(first(params.ev), ["sale_page", "nameserver"] as const, "" as never) || "",
    cls: first(params.cls).slice(0, 60),
    prov: first(params.prov).slice(0, 60),
    link: pick(first(params.link), ["yes", "no"] as const, "" as never) || "",
    q: normalizeQuery(first(params.q)),
    pat: patternActive(pat, exact) ? pat : "",
    exact: exact && patternActive(pat, exact),
    lmin,
    lmax,
    used: pick(first(params.used), ["never", "used"] as const, "" as never) || "",
    inr: posInt(first(params.inr)),
    eng: pick(first(params.eng), ["seen", "voted", "bookmarked"] as const, "" as never) || "",
    sort: pick(first(params.sort), BROWSE_SORTS, "name"),
    seed: first(params.seed).trim().slice(0, 40),
    page: posInt(first(params.page)) ?? 1,
  };
}

/** Query → URL params (defaults dropped so links stay short). */
export function browseToParams(q: BrowseQuery): Record<string, string | number | undefined> {
  return {
    hp: q.hp || undefined,
    src: q.src.length ? q.src.join(",") : undefined,
    cur: q.cur || undefined,
    min: q.min ?? undefined,
    max: q.max ?? undefined,
    sets: q.sets.length ? q.sets.join(",") : undefined,
    sm: q.sets.length > 1 && q.sm === "all" ? "all" : undefined,
    ev: q.ev || undefined,
    cls: q.cls || undefined,
    prov: q.prov || undefined,
    link: q.link || undefined,
    q: q.q || undefined,
    pat: q.pat || undefined,
    exact: q.exact ? 1 : undefined,
    lmin: q.lmin ?? undefined,
    lmax: q.lmax ?? undefined,
    used: q.used || undefined,
    inr: q.inr ?? undefined,
    eng: q.eng || undefined,
    sort: q.sort === "name" ? undefined : q.sort,
    seed: q.sort === "random" && q.seed ? q.seed : undefined,
  };
}

/** Number of active filters (sort and page excluded). */
export function activeFilterCount(q: BrowseQuery) {
  const p = browseToParams(q);
  delete p.sort;
  delete p.seed;
  delete p.sm;
  if (p.exact) delete p.exact;
  return Object.values(p).filter((v) => v !== undefined).length;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const used = "EXISTS (SELECT 1 FROM domains d WHERE d.name = p.name)";

export function browseWhere(q: BrowseQuery) {
  const w: string[] = [];
  const params: Array<string | number> = [];
  if (q.hp === "yes") w.push("p.has_price = 1");
  if (q.hp === "no") w.push("p.has_price = 0");
  if (q.src.length) {
    const named = q.src.filter((s) => s !== NONE);
    const parts: string[] = [];
    if (named.length) {
      parts.push(`p.price_source IN (${named.map(() => "?").join(",")})`);
      params.push(...named);
    }
    if (q.src.includes(NONE)) parts.push("p.price_source IS NULL");
    w.push(`(${parts.join(" OR ")})`);
  }
  if (q.cur === "usd") w.push("p.price_usd IS NOT NULL");
  if (q.cur === "other") w.push("p.has_price = 1 AND p.price_usd IS NULL");
  if (q.cur === "none") w.push("p.has_price = 0");
  if (q.min != null) {
    w.push("p.price_usd >= ?");
    params.push(q.min);
  }
  if (q.max != null) {
    w.push("p.price_usd <= ?");
    params.push(q.max);
  }
  if (q.sets.length) w.push(`(${q.sets.map((n) => `p.set_${n} = 1`).join(q.sm === "all" ? " AND " : " OR ")})`);
  if (q.ev) {
    w.push("p.evidence = ?");
    params.push(q.ev);
  }
  for (const [value, col] of [[q.cls, "dns_ns_class"], [q.prov, "dns_parking_provider"]] as const) {
    if (!value) continue;
    if (value === NONE) w.push(`p.${col} IS NULL`);
    else {
      w.push(`p.${col} = ?`);
      params.push(value);
    }
  }
  if (q.link === "yes") w.push("(p.lp_url IS NOT NULL) = 1");
  if (q.link === "no") w.push("(p.lp_url IS NOT NULL) = 0");
  if (q.q) {
    w.push("p.name LIKE ? ESCAPE '\\'");
    params.push(`%${likeEscape(q.q)}%`);
  }
  if (q.pat) {
    // The pattern only holds [a-z0-9-_]; "_" is LIKE's any-char. The label must reach the last slot.
    w.push(q.exact ? "p.name_len = ?" : "p.name_len >= ?", "p.name LIKE ?");
    params.push(q.pat.length, `${q.pat}%`);
  }
  if (q.lmin != null || q.lmax != null) {
    // A length filter matching most of the pool (5 letters ≈ 76%) is cheaper as a walk of the
    // name-ordered table than an index range + sort of every match; "+" keeps SQLite off the
    // length indexes then (left alone it picks pool_len_price_idx and sorts 400k rows per page).
    const counts = poolLengthCounts();
    const all = counts.reduce((a, c) => a + c.count, 0);
    const hit = counts.filter((c) => (q.lmin == null || c.length >= q.lmin) && (q.lmax == null || c.length <= q.lmax)).reduce((a, c) => a + c.count, 0);
    const col = all > 0 && hit / all > 0.3 ? "+p.name_len" : "p.name_len";
    if (q.lmin != null && q.lmin === q.lmax) {
      w.push(`${col} = ?`);
      params.push(q.lmin);
    } else {
      if (q.lmin != null) {
        w.push(`${col} >= ?`);
        params.push(q.lmin);
      }
      if (q.lmax != null) {
        w.push(`${col} <= ?`);
        params.push(q.lmax);
      }
    }
  }
  if (q.used === "never") w.push(`NOT ${used}`);
  if (q.used === "used") w.push(used);
  if (q.inr != null) {
    w.push("EXISTS (SELECT 1 FROM domains d WHERE d.name = p.name AND d.round_id = ?)");
    params.push(q.inr);
  }
  if (q.eng === "seen") w.push("EXISTS (SELECT 1 FROM domains d JOIN views v ON v.domain_id = d.id WHERE d.name = p.name)");
  if (q.eng === "voted") w.push("EXISTS (SELECT 1 FROM domains d JOIN votes v ON v.domain_id = d.id WHERE d.name = p.name)");
  if (q.eng === "bookmarked") w.push("EXISTS (SELECT 1 FROM picks k WHERE k.name = p.name)");
  return { sql: w.length ? `WHERE ${w.join(" AND ")}` : "", params };
}

const votesOf = "(SELECT COUNT(*) FROM domains d JOIN votes v ON v.domain_id = d.id WHERE d.name = p.name)";

function seededRank(seed: string, name: string) {
  let h = 0x811c9dc5;
  const text = `${seed}:${name}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function orderSql(q: BrowseQuery): { sql: string; params: string[] } {
  switch (q.sort) {
    case "price_asc":
      return { sql: "p.price_usd IS NULL, p.price_usd ASC, p.name", params: [] };
    case "price_desc":
      return { sql: "p.price_usd IS NULL, p.price_usd DESC, p.name", params: [] };
    case "votes":
      return { sql: `${votesOf} DESC, p.name`, params: [] };
    case "random":
      getSqlite().function("dv_browse_rank", { deterministic: true }, (s: unknown, n: unknown) => seededRank(String(s), String(n)));
      return { sql: "dv_browse_rank(?, p.name), p.name", params: [q.seed || "dv"] };
    default:
      return { sql: "p.name", params: [] };
  }
}

export type BrowseRow = {
  name: string;
  price: number | null;
  currency: string | null;
  priceUsd: number | null;
  source: string | null;
  evidence: string | null;
  provider: string | null;
  nsClass: string | null;
  url: string | null;
  sets: string; // e.g. "1,3"
  rounds: number;
  views: number;
  votes: number;
  bookmarked: number;
};

const ROW_SELECT = `p.name, coalesce(p.lp_price, p.best_price) AS price, CASE WHEN p.lp_price IS NOT NULL THEN p.lp_currency ELSE coalesce(p.lp_currency, CASE WHEN p.price_usd IS NOT NULL THEN 'USD' END) END AS currency,
  p.price_usd AS priceUsd, p.price_source AS source, p.evidence, p.dns_parking_provider AS provider, p.dns_ns_class AS nsClass, p.lp_url AS url,
  rtrim((CASE WHEN p.set_1 = 1 THEN '1,' ELSE '' END) || (CASE WHEN p.set_3 = 1 THEN '3,' ELSE '' END) || (CASE WHEN p.set_4 = 1 THEN '4,' ELSE '' END) || (CASE WHEN p.set_5 = 1 THEN '5,' ELSE '' END), ',') AS sets,
  (SELECT COUNT(DISTINCT d.round_id) FROM domains d WHERE d.name = p.name) AS rounds,
  (SELECT COUNT(*) FROM domains d JOIN views v ON v.domain_id = d.id WHERE d.name = p.name) AS views,
  ${votesOf} AS votes,
  EXISTS (SELECT 1 FROM picks k WHERE k.name = p.name) AS bookmarked`;

/** Pool-only filters can be cached until the data changes; used/round/engagement ones depend on live votes. */
function countWhere(q: BrowseQuery, where: { sql: string; params: Array<string | number> }) {
  const run = () => (getSqlite().prepare(`SELECT COUNT(*) AS n FROM pool p ${where.sql}`).get(...where.params) as { n: number }).n;
  return q.used || q.inr != null || q.eng ? run() : cachedCount("pool", where.sql, where.params, run);
}

export function browsePool(q: BrowseQuery, pageSize = BROWSE_PAGE_SIZE) {
  const sqlite = getSqlite();
  const where = browseWhere(q);
  const total = countWhere(q, where);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(q.page, pages);
  const order = orderSql(q);
  const rows = sqlite
    .prepare(`SELECT ${ROW_SELECT} FROM pool p ${where.sql} ORDER BY ${order.sql} LIMIT ? OFFSET ?`)
    .all(...where.params, ...order.params, pageSize, (page - 1) * pageSize) as BrowseRow[];
  return { total, page, pages, rows };
}

/** Explore → round: the filtered names, in Explore's current order, become a new open round. */
export function createRoundFromBrowse(title: string, q: BrowseQuery) {
  const sqlite = getSqlite();
  const where = browseWhere(q);
  const order = orderSql(q);
  return sqlite.transaction(() => {
    const now = Date.now();
    const id = Number(
      sqlite
        .prepare(
          `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source)
           VALUES (?, 'open', NULL, ?, ?, ?, ?, 'pool')`,
        )
        .run(title, JSON.stringify({ explore: browseToParams(q) }), q.sort, now, now).lastInsertRowid,
    );
    const inserted = sqlite
      .prepare(
        `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency)
         SELECT ?, ROW_NUMBER() OVER (ORDER BY ${order.sql}), p.name, COALESCE(p.lp_price, p.best_price), 0, NULL, p.name, p.lp_currency
         FROM pool p ${where.sql}
         ORDER BY ${order.sql}`,
      )
      .run(id, ...order.params, ...where.params, ...order.params);
    if (inserted.changes === 0) sqlite.prepare("DELETE FROM rounds WHERE id = ?").run(id);
    return { id, count: inserted.changes };
  })();
}

/** Total matches only (no rows). */
export function countBrowse(q: BrowseQuery) {
  return countWhere(q, browseWhere(q));
}

export function* iterateBrowse(q: BrowseQuery) {
  const where = browseWhere(q);
  const order = orderSql(q);
  yield* getSqlite()
    .prepare(`SELECT ${ROW_SELECT} FROM pool p ${where.sql} ORDER BY ${order.sql}`)
    .iterate(...where.params, ...order.params) as IterableIterator<BrowseRow>;
}

export type Facet = { value: string | null; count: number };

type Facets = { sources: Facet[]; providers: Facet[]; classes: Facet[]; lengths: Array<{ length: number; count: number }> };

/**
 * Option lists with whole-pool counts for the filter controls.
 * Whole-pool GROUP BYs grow with the 3/5-letter imports, so they are cached until the pool changes.
 */
export function browseFacets(): Facets {
  return cached("browseFacets", computeFacets);
}

function computeFacets(): Facets {
  const sqlite = getSqlite();
  const facet = (col: string) => sqlite.prepare(`SELECT ${col} AS value, COUNT(*) AS count FROM pool GROUP BY ${col} ORDER BY count DESC`).all() as Facet[];
  return { sources: facet("price_source"), providers: facet("dns_parking_provider"), classes: facet("dns_ns_class"), lengths: poolLengthCounts() };
}

export type OverviewRow = { key: string; total: number; priced: number; usd: number; median: number | null; perSet: number[]; only?: number };

function median(where: string, params: Array<string | number>, usd: number) {
  if (!usd) return null;
  const row = getSqlite()
    .prepare(`SELECT price_usd AS v FROM pool WHERE ${where} AND price_usd IS NOT NULL ORDER BY price_usd LIMIT 1 OFFSET ?`)
    .get(...params, Math.floor((usd - 1) / 2)) as { v: number } | undefined;
  return row?.v ?? null;
}

/** Pool page matrices: per set, and per price source (with its split across sets). Cached until the pool changes. */
export function poolOverview() {
  return cached("poolOverview", computeOverview);
}

function computeOverview() {
  const sqlite = getSqlite();
  const bySet: OverviewRow[] = ACTIVE_SETS.map((n) => {
    const r = sqlite
      .prepare(`SELECT COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd FROM pool WHERE set_${n} = 1`)
      .get() as { total: number; priced: number; usd: number };
    // Sets overlap (1∩3 is large), so also count names found in no other shown set.
    const others = ACTIVE_SETS.filter((m) => m !== n).map((m) => `set_${m} = 0`).join(" AND ");
    const only = (sqlite.prepare(`SELECT COUNT(*) AS n FROM pool WHERE set_${n} = 1 AND ${others}`).get() as { n: number }).n;
    return { key: String(n), ...r, only, median: median(`set_${n} = 1`, [], r.usd), perSet: [] };
  });
  const sources = sqlite
    .prepare(
      `SELECT price_source AS key, COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd,
              SUM(set_1) AS s1, SUM(set_3) AS s3, SUM(set_4) AS s4, SUM(set_5) AS s5
       FROM pool GROUP BY price_source ORDER BY price_source IS NULL, total DESC`,
    )
    .all() as Array<{ key: string | null; total: number; priced: number; usd: number; s1: number; s3: number; s4: number; s5: number }>;
  const bySource: OverviewRow[] = sources.map((r) => ({
    key: r.key ?? NONE,
    total: r.total,
    priced: r.priced,
    usd: r.usd,
    median: r.key == null ? null : median("price_source = ?", [r.key], r.usd),
    perSet: [r.s1, r.s3, r.s4, r.s5].map((x) => x ?? 0),
  }));
  const totals = sqlite
    .prepare("SELECT COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd, MAX(imported_at) AS lastImport FROM pool")
    .get() as { total: number; priced: number; usd: number; lastImport: number | null };
  // Per label length (3/4/5…): same columns as per set, plus the set split.
  const byLength: OverviewRow[] = (
    sqlite
      .prepare(
        `SELECT name_len AS len, COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd,
                SUM(set_1) AS s1, SUM(set_3) AS s3, SUM(set_4) AS s4, SUM(set_5) AS s5
         FROM pool GROUP BY name_len ORDER BY name_len`,
      )
      .all() as Array<{ len: number; total: number; priced: number; usd: number; s1: number; s3: number; s4: number; s5: number }>
  ).map((r) => ({
    key: String(r.len),
    total: r.total,
    priced: r.priced,
    usd: r.usd,
    median: median("name_len = ?", [r.len], r.usd),
    perSet: [r.s1, r.s3, r.s4, r.s5].map((x) => x ?? 0),
  }));
  const overlap13 = (sqlite.prepare("SELECT COUNT(*) AS n FROM pool WHERE set_1 = 1 AND set_3 = 1").get() as { n: number }).n;
  return { bySet, bySource, byLength, totals, overlap13 };
}

/** A few example names per set for the set tooltips. */
export function setSamples(limit = 4): Record<number, string[]> {
  return cached(`setSamples:${limit}`, () => computeSamples(limit));
}

function computeSamples(limit: number): Record<number, string[]> {
  const sqlite = getSqlite();
  const out: Record<number, string[]> = {};
  for (const n of ACTIVE_SETS) {
    out[n] = (sqlite.prepare(`SELECT name FROM pool WHERE set_${n} = 1 AND name_len <= 8 LIMIT ?`).all(limit) as Array<{ name: string }>).map((r) => r.name);
  }
  return out;
}
