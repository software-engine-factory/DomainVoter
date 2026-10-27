import { getSqlite } from "@/db";
import { cached, cachedCount } from "@/lib/data-cache";
import { t } from "@/lib/copy/fa";
import { normalizeSetIds } from "@/lib/sets";

export type PoolFilters = {
  classes: string[];
  providers: string[];
  sets: number[];
  setMode: "any" | "all";
  evidence: "any" | "sale_page" | "nameserver";
  minUsd: number | null;
  maxUsd: number | null;
  includeUnpriced: boolean;
  order: "provider" | "name" | "price_asc" | "price_desc" | "random";
  /** Label length (3, 4, 5…). null = any length; new rounds always pick one (no mixed-length rounds). */
  length?: number | null;
};

export function emptyPoolFilters(): PoolFilters {
  return {
    classes: [],
    providers: [],
    sets: [],
    setMode: "any",
    evidence: "any",
    minUsd: null,
    maxUsd: null,
    includeUnpriced: true,
    order: "provider",
    length: null,
  };
}

function lengthValue(value: unknown) {
  const n = Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 63 ? n : null;
}

function list(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (value == null || value === "") return [];
  return String(value).split(",").map((v) => v.trim()).filter(Boolean);
}

function optionalNumber(value: unknown) {
  const out = String(value ?? "").trim();
  if (!out) return null;
  const parsed = Number(out);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePoolFilters(input: Record<string, unknown>): { filters: PoolFilters; error?: string } {
  const filters: PoolFilters = {
    classes: list(input.classes),
    providers: list(input.providers),
    sets: normalizeSetIds(list(input.sets)),
    setMode: input.setMode === "all" ? "all" : "any",
    evidence: input.evidence === "sale_page" || input.evidence === "nameserver" ? input.evidence : "any",
    minUsd: optionalNumber(input.minUsd),
    maxUsd: optionalNumber(input.maxUsd),
    includeUnpriced: !(input.includeUnpriced === false || input.includeUnpriced === "0" || input.includeUnpriced === "false"),
    order: (["provider", "name", "price_asc", "price_desc", "random"] as const).includes(input.order as never)
      ? (input.order as PoolFilters["order"])
      : "provider",
    length: lengthValue(input.length),
  };
  if (filters.minUsd != null && filters.maxUsd != null && filters.minUsd > filters.maxUsd) {
    return { filters, error: t.pool.err.priceRange };
  }
  return { filters };
}

/** Builds the WHERE clause for pool rows. Every predicate hits an indexed column. */
export function poolWhere(filters: PoolFilters, alias = "p") {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const NONE = "__none__";
  if (filters.classes.length) {
    const named = filters.classes.filter((c) => c !== NONE);
    const parts = [];
    if (named.length) {
      parts.push(`${alias}.dns_ns_class IN (${named.map(() => "?").join(", ")})`);
      params.push(...named);
    }
    if (filters.classes.includes(NONE)) parts.push(`${alias}.dns_ns_class IS NULL`);
    clauses.push(`(${parts.join(" OR ")})`);
  }
  if (filters.providers.length) {
    const named = filters.providers.filter((c) => c !== NONE);
    const parts = [];
    if (named.length) {
      parts.push(`${alias}.dns_parking_provider IN (${named.map(() => "?").join(", ")})`);
      params.push(...named);
    }
    if (filters.providers.includes(NONE)) parts.push(`${alias}.dns_parking_provider IS NULL`);
    clauses.push(`(${parts.join(" OR ")})`);
  }
  if (filters.length != null) {
    clauses.push(`${alias}.name_len = ?`);
    params.push(filters.length);
  }
  if (filters.sets.length) {
    const join = filters.setMode === "all" ? " AND " : " OR ";
    clauses.push(`(${filters.sets.map((n) => `${alias}.set_${n} = 1`).join(join)})`);
  }
  if (filters.evidence !== "any") {
    clauses.push(`${alias}.evidence = ?`);
    params.push(filters.evidence);
  }
  if (filters.minUsd != null || filters.maxUsd != null) {
    const band: string[] = [];
    if (filters.minUsd != null) {
      band.push(`${alias}.price_usd >= ?`);
      params.push(filters.minUsd);
    }
    if (filters.maxUsd != null) {
      band.push(`${alias}.price_usd <= ?`);
      params.push(filters.maxUsd);
    }
    const priced = band.join(" AND ");
    // "Include unpriced" keeps names whose USD price is unknown (no price or another currency).
    clauses.push(filters.includeUnpriced ? `((${priced}) OR ${alias}.price_usd IS NULL)` : `(${priced})`);
  } else if (!filters.includeUnpriced) {
    clauses.push(`${alias}.price_usd IS NOT NULL`);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function poolOrder(order: PoolFilters["order"], alias = "p") {
  switch (order) {
    case "name":
      return `${alias}.name ASC`;
    case "price_asc":
      return `${alias}.price_usd IS NULL, ${alias}.price_usd ASC, ${alias}.name ASC`;
    case "price_desc":
      return `${alias}.price_usd IS NULL, ${alias}.price_usd DESC, ${alias}.name ASC`;
    case "random":
      return "random()";
    default:
      return `${alias}.dns_ns_class IS NULL, ${alias}.dns_ns_class, ${alias}.dns_parking_provider IS NULL, ${alias}.dns_parking_provider, ${alias}.name`;
  }
}

export function countPool(filters: PoolFilters) {
  const where = poolWhere(filters);
  return cachedCount("pool", where.sql, where.params, () => (getSqlite().prepare(`SELECT COUNT(*) AS n FROM pool p ${where.sql}`).get(...where.params) as { n: number }).n);
}

export type PoolFacet = { value: string | null; count: number; priced: number };

/** Whole-pool facets for the round forms; cached until the pool changes. */
export function poolFacets() {
  return cached("poolFacets", computePoolFacets);
}

function computePoolFacets() {
  const sqlite = getSqlite();
  const facet = (column: string) =>
    sqlite
      .prepare(
        `SELECT ${column} AS value, COUNT(*) AS count, COUNT(price_usd) AS priced
         FROM pool GROUP BY ${column} ORDER BY count DESC`,
      )
      .all() as PoolFacet[];
  const totals = sqlite
    .prepare(
      `SELECT COUNT(*) AS total,
              COUNT(lp_price) + SUM(CASE WHEN lp_price IS NULL AND best_price IS NOT NULL THEN 1 ELSE 0 END) AS priced,
              COUNT(price_usd) AS pricedUsd,
              SUM(set_1) AS s1, SUM(set_2) AS s2, SUM(set_3) AS s3, SUM(set_4) AS s4, SUM(set_5) AS s5,
              MAX(imported_at) AS lastImport
       FROM pool`,
    )
    .get() as {
    total: number;
    priced: number | null;
    pricedUsd: number;
    s1: number | null;
    s2: number | null;
    s3: number | null;
    s4: number | null;
    s5: number | null;
    lastImport: number | null;
  };
  return {
    totals,
    classes: facet("dns_ns_class"),
    providers: facet("dns_parking_provider"),
    evidence: facet("evidence"),
  };
}

export type LengthCount = { length: number; count: number };

/** Names per label length, for the round-creation length picker (index-only scan of pool_name_len_idx). */
export function poolLengthCounts(): LengthCount[] {
  return cached("poolLengthCounts", () => getSqlite().prepare("SELECT name_len AS length, COUNT(*) AS count FROM pool GROUP BY name_len ORDER BY name_len").all() as LengthCount[]);
}

/** The length a new round starts on: 4 when present (the original pool), else the biggest group. */
export function defaultLength(counts: LengthCount[]) {
  if (counts.some((c) => c.length === 4)) return 4;
  return [...counts].sort((a, b) => b.count - a.count)[0]?.length ?? null;
}

export function recentImports(limit = 5) {
  return getSqlite()
    .prepare("SELECT * FROM imports ORDER BY id DESC LIMIT ?")
    .all(limit) as Array<{
    id: number;
    source: string;
    started_at: number;
    finished_at: number | null;
    rows_read: number;
    rows_upserted: number;
    rows_skipped: number;
    error: string | null;
  }>;
}

/** Persian set names (see t.poolSets; set 2 is retired, see lib/sets). */
export const SET_LABELS: Record<number, string> = t.poolSets.name;
