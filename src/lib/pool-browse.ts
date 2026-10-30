import { getSqlite } from "@/db";
import { cachedAsync, cachedCountAsync, dataStamp } from "@/lib/data-cache";
import { reader } from "@/lib/ro";
import { createPoolRound, orderedNames } from "@/lib/bulk-fill";
import { poolLengthCounts } from "@/lib/pool";
import { normalizePattern, normalizeQuery, patternActive, PATTERN_MAX } from "@/lib/vote-view";
import { ACTIVE_SETS, normalizeSetIds, SCREENING_SETS, setListSql, setSumsSql } from "@/lib/sets";

/**
 * Admin pool explorer: the exploration filters over the whole pool (for sale + free to register, `av`).
 * Server-side, URL state, paginated. Columns price_source / has_price / name_len come from migration v6.
 */
type Params = Record<string, string | string[] | undefined>;

export const BROWSE_SORTS = ["name", "price_asc", "price_desc", "votes", "random"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];
export const NONE = "__none__";
export const BROWSE_PAGE_SIZE = 50;
const CURSOR_SORTS = new Set<BrowseSort>(["name", "price_asc", "price_desc"]);

export type BrowseQuery = {
  av: "" | "sale" | "free"; // availability: for sale / free to register ("" = both)
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
  cursor: string;
  direction: "next" | "prev";
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
    av: pick(first(params.av), ["sale", "free"] as const, "" as never) || "",
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
    cursor: first(params.cursor).slice(0, 253),
    direction: first(params.direction) === "prev" ? "prev" : "next",
  };
}

/** Query → URL params (defaults dropped so links stay short). */
export function browseToParams(q: BrowseQuery): Record<string, string | number | undefined> {
  return {
    av: q.av || undefined,
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

export function browseCursorFromRow(q: BrowseQuery, row: BrowseRow) {
  if (q.sort === "name") return row.name;
  if (q.sort === "price_asc" || q.sort === "price_desc") {
    return row.priceUsd == null ? `N:${row.name}` : `V:${row.priceUsd}:${row.name}`;
  }
  return "";
}

function priceCursor(value: string) {
  const [kind, price, ...name] = value.split(":");
  if (kind === "N") return price ? { price: null, name: [price, ...name].join(":") } : null;
  if (!name.length) return null;
  const n = Number(price);
  return kind === "V" && Number.isFinite(n) ? { price: n, name: name.join(":") } : null;
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
// Keep correlated membership lookups on the base-table indexes. A correlated aggregate over
// domain_catalog makes SQLite build an automatic index over the full view on large pools.
const physicalUsed = "EXISTS (SELECT 1 FROM domains d WHERE d.name = p.name)";
const virtualUsed = `EXISTS (
  SELECT 1 FROM selection_items i INDEXED BY selection_items_name_idx
  JOIN round_domain_ranges rr ON rr.selection_id = i.selection_id
    AND i.position BETWEEN rr.start_position AND rr.end_position
  JOIN rounds r ON r.id = rr.round_id AND r.creation_job_id IS NULL
  WHERE i.name = p.name
)`;
const used = `(${physicalUsed} OR ${virtualUsed})`;

export function browseWhere(q: BrowseQuery) {
  const w: string[] = [];
  const params: Array<string | number> = [];
  if (q.av) {
    w.push("p.avail = ?");
    params.push(q.av);
  }
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
    const term = likeEscape(q.q);
    if (q.q.length >= 2 && /^[a-z0-9-]+$/.test(q.q)) {
      // Match all five-character label pairs plus suffixes from the compact suffix dictionary.
      // The original LIKE predicate remains the final oracle and handles any unusual name form.
      const labelCandidates = Array.from({ length: 4 }, (_, i) => {
        const pos = i + 1;
        return `SELECT name FROM pool INDEXED BY pool_pos${pos}_idx WHERE name_len = 5 AND substr(name, ${pos}, 1) = ? AND substr(name, ${pos + 1}, 1) = ? AND name LIKE ? ESCAPE '\\'`;
      });
      // Concatenation removes the suffix column's TEXT affinity from the IN value. Without
      // that, SQLite may apply a cast to the indexed expression and scan the 5-char range.
      const suffixCandidate = `SELECT name FROM pool INDEXED BY pool_len_suffix_idx WHERE name_len = 5 AND lower(substr(name, instr(name, '.') + 1)) IN (SELECT suffix || '' FROM pool_suffixes WHERE instr(suffix, ?) > 0) AND name LIKE ? ESCAPE '\\'`;
      const candidates = [...labelCandidates, suffixCandidate];
      for (let i = 0; i < 4; i++) params.push(q.q[0], q.q[1], `%${term}%`);
      params.push(q.q, `%${term}%`);
      const fixedAtFive = (q.lmin === 5 && q.lmax === 5) || (q.exact && q.pat.length === 5);
      if (!fixedAtFive) {
        const otherLengthCandidate = (op: "<" | ">") => `SELECT name FROM pool INDEXED BY pool_len_name_idx WHERE name_len ${op} 5 AND name LIKE ? ESCAPE '\\'`;
        candidates.push(otherLengthCandidate("<"), otherLengthCandidate(">"));
        params.push(`%${term}%`, `%${term}%`);
      }
      w.push(`p.name IN (${candidates.join(" UNION ")}) AND p.name LIKE ? ESCAPE '\\'`);
      params.push(`%${term}%`);
    } else {
      w.push("p.name LIKE ? ESCAPE '\\'");
      params.push(`%${term}%`);
    }
  }
  if (q.pat) {
    // The pattern only holds [a-z0-9-_]; "_" is LIKE's any-char. The label must reach the last slot.
    w.push(q.exact ? "p.name_len = ?" : "p.name_len >= ?");
    params.push(q.pat.length);
    if (q.exact && q.pat.length === 5) {
      const literalPos = [...q.pat].findIndex((c) => c !== "_") + 1;
      if (literalPos) {
        // Match just the first indexed literal, then retain SQLite LIKE as the oracle inside
        // the candidate scan. Character-class enumeration misses Unicode LIKE matches.
        const pairPos = Math.min(literalPos, 5);
        w.push(`p.name IN (SELECT name FROM pool INDEXED BY pool_pos${pairPos}_idx WHERE name_len = 5 AND substr(name, ${literalPos}, 1) = ? AND name LIKE ?)`);
        params.push(q.pat[literalPos - 1], `${q.pat}%`);
      }
    }
    w.push("p.name LIKE ?");
    params.push(`${q.pat}%`);
  }
  if (q.lmin != null || q.lmax != null) {
    if (q.lmin != null && q.lmin === q.lmax) {
      w.push("p.name_len = ?");
      params.push(q.lmin);
    } else {
      if (q.lmin != null) {
        w.push("p.name_len >= ?");
        params.push(q.lmin);
      }
      if (q.lmax != null) {
        w.push("p.name_len <= ?");
        params.push(q.lmax);
      }
    }
  }
  if (q.used === "never") w.push(`NOT ${used}`);
  if (q.used === "used") w.push(used);
  if (q.inr != null) {
    w.push(`(EXISTS (SELECT 1 FROM domains d WHERE d.name = p.name AND d.round_id = ?)
      OR EXISTS (
        SELECT 1 FROM round_domain_ranges rr
        JOIN rounds r ON r.id = rr.round_id AND r.creation_job_id IS NULL
        JOIN selection_items i INDEXED BY selection_items_name_idx ON i.selection_id = rr.selection_id
          AND i.position BETWEEN rr.start_position AND rr.end_position
        WHERE rr.round_id = ? AND i.name = p.name
      ))`);
    params.push(q.inr, q.inr);
  }
  if (q.eng === "seen") w.push("EXISTS (SELECT 1 FROM domains d JOIN views v ON v.domain_id = d.id WHERE d.name = p.name)");
  if (q.eng === "voted") w.push("EXISTS (SELECT 1 FROM domains d JOIN votes v ON v.domain_id = d.id WHERE d.name = p.name)");
  if (q.eng === "bookmarked") w.push("EXISTS (SELECT 1 FROM picks k WHERE k.name = p.name)");
  return { sql: w.length ? `WHERE ${w.join(" AND ")}` : "", params };
}

const votesOf = "(SELECT COUNT(*) FROM domains d JOIN votes v ON v.domain_id = d.id WHERE d.name = p.name)";

export function orderSql(q: BrowseQuery): { sql: string; params: string[] } {
  switch (q.sort) {
    case "price_asc":
      return { sql: "p.price_usd IS NULL, p.price_usd ASC, p.name", params: [] };
    case "price_desc":
      return { sql: "p.price_usd IS NULL, p.price_usd DESC, p.name", params: [] };
    case "votes":
      return { sql: `${votesOf} DESC, p.name`, params: [] };
    case "random":
      // dv_browse_rank is registered on every reader connection (lib/ro) and by ensureRank() below.
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
  avail: "sale" | "free";
  regPrice: number | null;
};

export const BROWSE_ROW_SELECT = `p.name, coalesce(p.lp_price, p.best_price) AS price, CASE WHEN p.lp_price IS NOT NULL THEN p.lp_currency ELSE coalesce(p.lp_currency, CASE WHEN p.price_usd IS NOT NULL THEN 'USD' END) END AS currency,
  p.price_usd AS priceUsd, p.price_source AS source, p.evidence, p.dns_parking_provider AS provider, p.dns_ns_class AS nsClass, p.lp_url AS url,
  ${setListSql("p")} AS sets,
  (SELECT COUNT(*) FROM (
    SELECT d.round_id AS round_id FROM domains d WHERE d.name = p.name
    UNION
    SELECT rr.round_id AS round_id
    FROM selection_items i INDEXED BY selection_items_name_idx
    JOIN round_domain_ranges rr ON rr.selection_id = i.selection_id
      AND i.position BETWEEN rr.start_position AND rr.end_position
    JOIN rounds r ON r.id = rr.round_id AND r.creation_job_id IS NULL
    WHERE i.name = p.name
  )) AS rounds,
  (SELECT COUNT(*) FROM domains d JOIN views v ON v.domain_id = d.id WHERE d.name = p.name) AS views,
  ${votesOf} AS votes,
  EXISTS (SELECT 1 FROM picks k WHERE k.name = p.name) AS bookmarked, p.avail, p.reg_price_usd AS regPrice`;

/** Pool aggregates follow the dataset stamp; membership also follows catalog revision. Engagement stays live. */
export function browseCountSql(q: BrowseQuery): { sql: string; params: Array<string | number> } | null {
  const otherFilters = q.hp || q.src.length || q.cur || q.min != null || q.max != null || q.sets.length || q.ev || q.cls || q.prov || q.link || q.q || q.pat || q.used || q.inr != null || q.eng;
  if (otherFilters) return null;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.lmin != null) { where.push("name_len >= ?"); params.push(q.lmin); }
  if (q.lmax != null) { where.push("name_len <= ?"); params.push(q.lmax); }
  if (q.av) { where.push("avail = ?"); params.push(q.av); }
  return { sql: `SELECT coalesce(SUM(n), 0) AS n FROM pool_length_totals${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`, params };
}

function countWhere(q: BrowseQuery, where: { sql: string; params: Array<string | number> }) {
  const run = async () => (await reader().get<{ n: number }>(`SELECT COUNT(*) AS n FROM pool p ${where.sql}`, where.params))!.n;
  const summary = browseCountSql(q);
  if (summary) return reader().get<{ n: number }>(summary.sql, summary.params).then((row) => row!.n);
  if (q.eng) return run();
  if (q.used || q.inr != null) {
    return reader().get<{ n: number }>("SELECT n FROM catalog_revision WHERE id = 1").then((revision) =>
      cachedCountAsync(`pool-${dataStamp()}-catalog-${revision!.n}`, where.sql, where.params, run),
    );
  }
  return cachedCountAsync("pool", where.sql, where.params, run);
}

function whereOf(q: BrowseQuery) {
  return browseWhere(q);
}

/** One Explore page. The UI can omit the optional exact total so it streams without waiting for COUNT. */
export async function browsePool(q: BrowseQuery, pageSize = BROWSE_PAGE_SIZE, includeTotal = true) {
  const where = await whereOf(q);
  const totalPromise = includeTotal ? countWhere(q, where) : null;
  const page = q.page;
  const pages = totalPromise ? Math.max(1, Math.ceil((await totalPromise) / pageSize)) : null;
  const resolvedPage = pages == null ? page : Math.min(page, pages);
  const order = orderSql(q);
  const parsedPrice = q.sort === "price_asc" || q.sort === "price_desc" ? priceCursor(q.cursor) : null;
  const useCursor = CURSOR_SORTS.has(q.sort) && Boolean(q.cursor) && (q.sort === "name" || parsedPrice != null);
  let cursorPredicate = "", cursorValues: Array<string | number> = [], cursorOrder = order.sql;
  if (useCursor && q.sort === "name") {
    cursorPredicate = `p.name ${q.direction === "prev" ? "<" : ">"} ?`;
    cursorValues = [q.cursor];
    if (q.direction === "prev") cursorOrder = "p.name DESC";
  } else if (useCursor && parsedPrice) {
    const asc = q.sort === "price_asc";
    const cmp = asc ? ">" : "<", backCmp = asc ? "<" : ">";
    if (parsedPrice.price == null) {
      cursorPredicate = q.direction === "prev"
        ? `(p.price_usd IS NOT NULL OR (p.price_usd IS NULL AND p.name < ?))`
        : `(p.price_usd IS NULL AND p.name > ?)`;
      cursorValues = [parsedPrice.name];
    } else if (q.direction === "prev") {
      cursorPredicate = `(p.price_usd IS NOT NULL AND (p.price_usd ${backCmp} ? OR (p.price_usd = ? AND p.name < ?)))`;
      cursorValues = [parsedPrice.price, parsedPrice.price, parsedPrice.name];
    } else {
      cursorPredicate = `(p.price_usd IS NULL OR (p.price_usd IS NOT NULL AND (p.price_usd ${cmp} ? OR (p.price_usd = ? AND p.name > ?))))`;
      cursorValues = [parsedPrice.price, parsedPrice.price, parsedPrice.name];
    }
    if (q.direction === "prev") {
      cursorOrder = parsedPrice.price == null
        ? `p.price_usd IS NULL DESC, p.price_usd ${asc ? "DESC" : "ASC"}, p.name DESC`
        : `p.price_usd ${asc ? "DESC" : "ASC"}, p.name DESC`;
    }
  }
  const cursorWhere = useCursor ? `${where.sql ? `${where.sql} AND` : "WHERE"} ${cursorPredicate}` : where.sql;
  const cursorParams = useCursor ? [...where.params, ...cursorValues] : where.params;
  const fetched = await reader().all<BrowseRow>(
    `SELECT ${BROWSE_ROW_SELECT} FROM pool p ${cursorWhere} ORDER BY ${cursorOrder} LIMIT ?${useCursor ? "" : " OFFSET ?"}`,
    [...cursorParams, ...order.params, pageSize + 1, ...(!useCursor ? [(resolvedPage - 1) * pageSize] : [])],
  );
  const hasMore = fetched.length > pageSize;
  let rows = fetched.slice(0, pageSize);
  if (useCursor && q.direction === "prev") rows = rows.reverse();
  return { total: totalPromise ? await totalPromise : null, pages, page: resolvedPage, rows, hasMore, hasPrevious: resolvedPage > 1, cursorMode: CURSOR_SORTS.has(q.sort) };
}

function ensureRank() {
  getSqlite().function("dv_browse_rank", { deterministic: true }, (s: unknown, n: unknown) => {
    let h = 0x811c9dc5;
    const text = `${String(s)}:${String(n)}`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  });
}

/** Explore → round: the filtered names, in Explore's current order, become a new open round (written in chunks, see lib/bulk-fill). */
export async function createRoundFromBrowse(title: string, q: BrowseQuery) {
  const where = await whereOf(q);
  const order = orderSql(q);
  if (q.sort === "random") ensureRank();
  const names = await orderedNames(`SELECT p.name AS name, ROW_NUMBER() OVER (ORDER BY ${order.sql}) AS rn FROM pool p ${where.sql}`, [...order.params, ...where.params]);
  return createPoolRound({ title, filterJson: JSON.stringify({ explore: browseToParams(q) }), sortMode: q.sort }, names);
}

/** Total matches only (no rows). */
export async function countBrowse(q: BrowseQuery) {
  return countWhere(q, await whereOf(q));
}

/** CSV export: the whole filtered pool, walked in a reader thread and handed over in chunks. */
export async function* iterateBrowse(q: BrowseQuery): AsyncGenerator<BrowseRow[]> {
  const where = await whereOf(q);
  const order = orderSql(q);
  yield* reader().chunks<BrowseRow>(`SELECT ${BROWSE_ROW_SELECT} FROM pool p ${where.sql} ORDER BY ${order.sql}`, [...where.params, ...order.params]);
}

export type Facet = { value: string | null; count: number };

type Facets = { sources: Facet[]; providers: Facet[]; classes: Facet[]; lengths: Array<{ length: number; count: number }> };

/**
 * Option lists with whole-pool counts for the filter controls.
 * Whole-pool GROUP BYs grow with the 3/5-letter imports, so they are cached until the pool changes.
 */
export function browseFacets(): Promise<Facets> {
  return cachedAsync("browseFacets", computeFacets);
}

async function computeFacets(): Promise<Facets> {
  const facet = (col: string) => reader().all<Facet>(`SELECT ${col} AS value, COUNT(*) AS count FROM pool GROUP BY ${col} ORDER BY count DESC`);
  const [sources, providers, classes, lengths] = await Promise.all([facet("price_source"), facet("dns_parking_provider"), facet("dns_ns_class"), poolLengthCounts()]);
  return { sources, providers, classes, lengths };
}

export type OverviewRow = { key: string; total: number; priced: number; usd: number; median: number | null; perSet: number[]; only?: number };

async function median(where: string, params: Array<string | number>, usd: number) {
  if (!usd) return null;
  const row = await reader().get<{ v: number }>(`SELECT price_usd AS v FROM pool WHERE ${where} AND price_usd IS NOT NULL ORDER BY price_usd LIMIT 1 OFFSET ?`, [
    ...params,
    Math.floor((usd - 1) / 2),
  ]);
  return row?.v ?? null;
}

/** Pool page matrices: per set, and per price source (with its split across sets). Cached until the pool changes. */
export function poolOverview() {
  return cachedAsync("poolOverview", computeOverview);
}

type Split = { total: number; priced: number; usd: number } & Record<`s${number}`, number | null>;

async function computeOverview() {
  const r = reader();
  const bySet: OverviewRow[] = await Promise.all(
    ACTIVE_SETS.map(async (n) => {
      // Sets overlap (1∩3 is large), so also count names found in no other shown set of the same family
      // (the screening sets 6-8 cut across 1-5 by design).
      const family = (m: number) => SCREENING_SETS.includes(m);
      const others = ACTIVE_SETS.filter((m) => m !== n && family(m) === family(n)).map((m) => `set_${m} = 0`).join(" AND ");
      const [row, only] = await Promise.all([
        r.get<{ total: number; priced: number; usd: number }>(`SELECT COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd FROM pool WHERE set_${n} = 1`),
        r.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pool WHERE set_${n} = 1 AND ${others}`),
      ]);
      return { key: String(n), ...row!, only: only!.n, median: await median(`set_${n} = 1`, [], row!.usd), perSet: [] };
    }),
  );
  const [sources, totals, lengths, overlap] = await Promise.all([
    r.all<Split & { key: string | null }>(
      `SELECT price_source AS key, COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd,
              ${setSumsSql()}
       FROM pool GROUP BY price_source ORDER BY price_source IS NULL, total DESC`,
    ),
    r.get<{ total: number; priced: number; usd: number; free: number; lastImport: number | null }>(
      "SELECT COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd, coalesce(SUM(avail = 'free'), 0) AS free, MAX(imported_at) AS lastImport FROM pool",
    ),
    // Per label length (3/4/5…): same columns as per set, plus the set split.
    r.all<Split & { len: number }>(
      `SELECT name_len AS len, COUNT(*) AS total, coalesce(SUM(has_price), 0) AS priced, COUNT(price_usd) AS usd,
              ${setSumsSql()}
       FROM pool GROUP BY name_len ORDER BY name_len`,
    ),
    r.get<{ n: number }>("SELECT COUNT(*) AS n FROM pool WHERE set_1 = 1 AND set_3 = 1"),
  ]);
  const bySource: OverviewRow[] = await Promise.all(
    sources.map(async (x) => ({
      key: x.key ?? NONE,
      total: x.total,
      priced: x.priced,
      usd: x.usd,
      median: x.key == null ? null : await median("price_source = ?", [x.key], x.usd),
      perSet: ACTIVE_SETS.map((n) => x[`s${n}`] ?? 0),
    })),
  );
  const byLength: OverviewRow[] = await Promise.all(
    lengths.map(async (x) => ({
      key: String(x.len),
      total: x.total,
      priced: x.priced,
      usd: x.usd,
      median: await median("name_len = ?", [x.len], x.usd),
      perSet: ACTIVE_SETS.map((n) => x[`s${n}`] ?? 0),
    })),
  );
  return { bySet, bySource, byLength, totals: totals!, overlap13: overlap!.n };
}

/** A few example names per set for the set tooltips. */
export function setSamples(limit = 4): Promise<Record<number, string[]>> {
  return cachedAsync(`setSamples:${limit}`, () => computeSamples(limit));
}

async function computeSamples(limit: number): Promise<Record<number, string[]>> {
  const out: Record<number, string[]> = {};
  for (const n of ACTIVE_SETS) {
    out[n] = (await reader().all<{ name: string }>(`SELECT name FROM pool WHERE set_${n} = 1 AND name_len <= 8 LIMIT ?`, [limit])).map((r) => r.name);
  }
  return out;
}
