import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { rounds } from "@/db/schema";
import type { RoundFilters } from "@/lib/filters";
import { poolOrder, poolWhere, type PoolFilters } from "@/lib/pool";


export type RoundListItem = {
  id: number;
  title: string;
  status: "open" | "closed";
  parentRoundId: number | null;
  parentTitle: string | null;
  createdAt: number;
  domainCount: number;
  viewedCount: number;
};

export type StoredDomain = {
  name: string;
  price: number | null;
  isPremium: boolean;
  sourceDomainId?: number | null;
};

export function getRound(id: number) {
  if (!Number.isInteger(id)) return undefined;
  return getDb().select().from(rounds).where(eq(rounds.id, id)).get();
}

export function listRounds(): RoundListItem[] {
  return getSqlite()
    .prepare(
      `SELECT r.id, r.title, r.status, r.parent_round_id AS parentRoundId, p.title AS parentTitle,
              r.created_at AS createdAt,
              (SELECT COUNT(*) FROM domains d WHERE d.round_id = r.id) AS domainCount,
              (SELECT COUNT(DISTINCT v.domain_id) FROM views v WHERE v.round_id = r.id) AS viewedCount
       FROM rounds r
       LEFT JOIN rounds p ON p.id = r.parent_round_id
       ORDER BY r.id DESC`,
    )
    .all() as RoundListItem[];
}

export function listOpenRounds(): RoundListItem[] {
  return listRounds().filter((round) => round.status === "open");
}

export function countDomains(roundId: number) {
  const row = getSqlite()
    .prepare("SELECT COUNT(*) AS count FROM domains WHERE round_id = ?")
    .get(roundId) as { count: number };
  return row.count;
}

export function getVoteCards(roundId: number, start: number, end: number) {
  const rows = getSqlite()
    .prepare(
      `SELECT id, position, name
       FROM domains
       WHERE round_id = ? AND position >= ? AND position <= ?
       ORDER BY position ASC`,
    )
    .all(roundId, start, end) as Array<{
    id: number;
    position: number;
    name: string;
  }>;

  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export function getUserVoteCount(roundId: number, userId: number) {
  const row = getSqlite()
    .prepare("SELECT COUNT(*) AS count FROM votes WHERE round_id = ? AND user_id = ?")
    .get(roundId, userId) as { count: number };
  return row.count;
}

export function getUserVotedIds(roundId: number, userId: number, domainIds: number[]) {
  if (domainIds.length === 0) return [];
  const placeholders = domainIds.map(() => "?").join(", ");
  const rows = getSqlite()
    .prepare(
      `SELECT domain_id AS domainId FROM votes
       WHERE round_id = ? AND user_id = ? AND domain_id IN (${placeholders})`,
    )
    .all(roundId, userId, ...domainIds) as Array<{ domainId: number }>;
  return rows.map((row) => row.domainId);
}

export function getDomainVoters(roundId: number, domainId: number) {
  return getSqlite()
    .prepare(
      `SELECT u.id, u.username
       FROM votes v
       JOIN users u ON u.id = v.user_id
       JOIN domains d ON d.id = v.domain_id
       WHERE v.domain_id = ? AND d.round_id = ?
       ORDER BY u.username ASC`,
    )
    .all(domainId, roundId) as Array<{ id: number; username: string }>;
}

export function getBallots(roundId: number) {
  return getSqlite()
    .prepare(
      `SELECT u.id, u.username, COUNT(v.id) AS votes
       FROM votes v
       JOIN users u ON u.id = v.user_id
       WHERE v.round_id = ?
       GROUP BY u.id
       ORDER BY votes DESC, u.username ASC`,
    )
    .all(roundId) as Array<{ id: number; username: string; votes: number }>;
}

export function getUserBallot(roundId: number, userId: number) {
  const rows = getSqlite()
    .prepare(
      `SELECT d.position, d.name, d.price, d.currency, d.pool_name AS poolName, d.is_premium AS isPremium
       FROM votes v
       JOIN domains d ON d.id = v.domain_id
       WHERE v.round_id = ? AND v.user_id = ?
       ORDER BY d.position ASC`,
    )
    .all(roundId, userId) as Array<{
    position: number;
    name: string;
    price: number | null;
    currency: string | null;
    poolName: string | null;
    isPremium: number;
  }>;
  return rows.map((row) => ({ ...row, isPremium: row.isPremium === 1 }));
}

export function createRound(input: {
  title: string;
  parentRoundId: number | null;
  filterJson: string | null;
  sortMode: string | null;
  rows: StoredDomain[];
}) {
  const sqlite = getSqlite();
  const now = Date.now();
  const insertRound = sqlite.prepare(
    `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at)
     VALUES (?, 'open', ?, ?, ?, ?, ?)`,
  );
  const insertDomain = sqlite.prepare(
    `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const run = sqlite.transaction(() => {
    const info = insertRound.run(
      input.title,
      input.parentRoundId,
      input.filterJson,
      input.sortMode,
      now,
      now,
    );
    const roundId = Number(info.lastInsertRowid);
    input.rows.forEach((row, index) => {
      insertDomain.run(
        roundId,
        index + 1,
        row.name,
        row.price,
        row.isPremium ? 1 : 0,
        row.sourceDomainId ?? null,
      );
    });
    return roundId;
  });

  return run();
}

export function closeRound(roundId: number) {
  getSqlite()
    .prepare("UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'")
    .run(Date.now(), roundId);
}

/** USD-comparable price for a round row: pool rounds use pool.price_usd, legacy CSV rounds use their own price. */
const ROUND_PRICE = "CASE WHEN d.pool_name IS NULL THEN d.price ELSE p.price_usd END";

function deriveWhere(filters: RoundFilters) {
  const clauses = ["d.round_id = ?"];
  const params: unknown[] = [];
  if (filters.minVotes != null) {
    clauses.push("COALESCE(v.votes, 0) >= ?");
    params.push(filters.minVotes);
  }
  if (filters.maxVotes != null) {
    clauses.push("COALESCE(v.votes, 0) <= ?");
    params.push(filters.maxVotes);
  }
  if (filters.premium === "premium") clauses.push("d.is_premium = 1");
  if (filters.premium === "standard") clauses.push("d.is_premium = 0");
  if (filters.minPrice != null) {
    clauses.push(`${ROUND_PRICE} >= ?`);
    params.push(filters.minPrice);
  }
  if (filters.maxPrice != null) {
    clauses.push(`${ROUND_PRICE} <= ?`);
    params.push(filters.maxPrice);
  }
  return { sql: clauses.join(" AND "), params };
}

const DERIVE_FROM = `FROM domains d
  LEFT JOIN pool p ON p.name = d.pool_name
  LEFT JOIN (SELECT domain_id, COUNT(*) AS votes FROM votes WHERE round_id = ? GROUP BY domain_id) v ON v.domain_id = d.id`;

export function countMatching(roundId: number, filters: RoundFilters) {
  const where = deriveWhere(filters);
  return (
    getSqlite().prepare(`SELECT COUNT(*) AS n ${DERIVE_FROM} WHERE ${where.sql}`).get(roundId, roundId, ...where.params) as {
      n: number;
    }
  ).n;
}

/** Copies matching rows of a round into a new round entirely inside SQLite. */
export function deriveRound(input: { title: string; parentRoundId: number; filters: RoundFilters }) {
  const sqlite = getSqlite();
  const where = deriveWhere(input.filters);
  const order = input.filters.sort === "votes" ? "COALESCE(v.votes, 0) DESC, d.position ASC" : "d.position ASC";
  const parent = getRound(input.parentRoundId);
  return sqlite.transaction(() => {
    const now = Date.now();
    const info = sqlite
      .prepare(
        `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source)
         VALUES (?, 'open', ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.title, input.parentRoundId, JSON.stringify(input.filters), input.filters.sort, now, now, parent?.source ?? "csv");
    const id = Number(info.lastInsertRowid);
    const inserted = sqlite
      .prepare(
        `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency)
         SELECT ?, ROW_NUMBER() OVER (ORDER BY ${order}), d.name, d.price, d.is_premium, d.id, d.pool_name, d.currency
         ${DERIVE_FROM} WHERE ${where.sql}
         ORDER BY ${order}`,
      )
      .run(id, input.parentRoundId, input.parentRoundId, ...where.params);
    return { id, count: inserted.changes };
  })();
}

/** Opens a round straight from the pool: one INSERT…SELECT, no rows pass through JS. */
export function createRoundFromPool(title: string, filters: PoolFilters) {
  const sqlite = getSqlite();
  const where = poolWhere(filters);
  const order = poolOrder(filters.order);
  return sqlite.transaction(() => {
    const now = Date.now();
    const info = sqlite
      .prepare(
        `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source)
         VALUES (?, 'open', NULL, ?, ?, ?, ?, 'pool')`,
      )
      .run(title, JSON.stringify(filters), filters.order, now, now);
    const id = Number(info.lastInsertRowid);
    const inserted = sqlite
      .prepare(
        `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency)
         SELECT ?, ROW_NUMBER() OVER (ORDER BY ${order}), p.name, COALESCE(p.lp_price, p.best_price), 0, NULL, p.name, p.lp_currency
         FROM pool p ${where.sql}
         ORDER BY ${order}`,
      )
      .run(id, ...where.params);
    if (inserted.changes === 0) {
      sqlite.prepare("DELETE FROM rounds WHERE id = ?").run(id);
    }
    return { id, count: inserted.changes };
  })();
}

export type AdminRow = {
  id: number;
  position: number;
  name: string;
  price: number | null;
  currency: string | null;
  isPremium: number;
  poolName: string | null;
  provider: string | null;
  nsClass: string | null;
  evidence: string | null;
  marketplace: string | null;
  url: string | null;
  bestSource: string | null;
  votes: number;
  viewers: number;
  picked: number;
};

export type ResultsQuery = {
  sort: "position" | "name" | "price" | "votes" | "viewers";
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  provider?: string;
  nsClass?: string;
  evidence?: string;
  minVotes?: number | null;
  pickedOnly?: boolean;
  unviewedOnly?: boolean;
  search?: string;
};

const ROW_SELECT = `SELECT d.id, d.position, d.name, d.price, d.currency, d.is_premium AS isPremium, d.pool_name AS poolName,
       p.dns_parking_provider AS provider, p.dns_ns_class AS nsClass, p.evidence, p.lp_marketplace AS marketplace,
       p.lp_url AS url, p.best_source AS bestSource,
       COALESCE(v.votes, 0) AS votes, COALESCE(w.viewers, 0) AS viewers,
       CASE WHEN k.name IS NULL THEN 0 ELSE 1 END AS picked`;

const ROW_FROM = `FROM domains d
  LEFT JOIN pool p ON p.name = d.pool_name
  LEFT JOIN picks k ON k.name = d.name
  LEFT JOIN (SELECT domain_id, COUNT(*) AS votes FROM votes WHERE round_id = ? GROUP BY domain_id) v ON v.domain_id = d.id
  LEFT JOIN (SELECT domain_id, COUNT(*) AS viewers FROM views WHERE round_id = ? GROUP BY domain_id) w ON w.domain_id = d.id`;

function resultsWhere(roundId: number, q: ResultsQuery) {
  const clauses = ["d.round_id = ?"];
  const params: unknown[] = [roundId];
  if (q.provider) {
    if (q.provider === "__none__") clauses.push("p.dns_parking_provider IS NULL");
    else {
      clauses.push("p.dns_parking_provider = ?");
      params.push(q.provider);
    }
  }
  if (q.nsClass) {
    clauses.push("p.dns_ns_class = ?");
    params.push(q.nsClass);
  }
  if (q.evidence) {
    clauses.push("p.evidence = ?");
    params.push(q.evidence);
  }
  if (q.minVotes != null) {
    clauses.push("COALESCE(v.votes, 0) >= ?");
    params.push(q.minVotes);
  }
  if (q.pickedOnly) clauses.push("k.name IS NOT NULL");
  if (q.unviewedOnly) clauses.push("w.viewers IS NULL");
  if (q.search) {
    clauses.push("d.name LIKE ?");
    params.push(`%${q.search.toLowerCase()}%`);
  }
  return { sql: clauses.join(" AND "), params };
}

function resultsOrder(q: ResultsQuery) {
  const dir = q.dir === "desc" ? "DESC" : "ASC";
  switch (q.sort) {
    case "name":
      return `d.name ${dir}`;
    case "price":
      // USD-only sort; unpriced and non-USD rows go last either way.
      return `${ROUND_PRICE} IS NULL, ${ROUND_PRICE} ${dir}, d.position`;
    case "votes":
      return `votes ${dir}, d.position`;
    case "viewers":
      return `viewers ${dir}, d.position`;
    default:
      return `d.position ${dir}`;
  }
}

export function queryResults(roundId: number, q: ResultsQuery) {
  const sqlite = getSqlite();
  const where = resultsWhere(roundId, q);
  const total = (
    sqlite.prepare(`SELECT COUNT(*) AS n ${ROW_FROM} WHERE ${where.sql}`).get(roundId, roundId, ...where.params) as { n: number }
  ).n;
  const pages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(Math.max(1, q.page), pages);
  const rows = sqlite
    .prepare(`${ROW_SELECT} ${ROW_FROM} WHERE ${where.sql} ORDER BY ${resultsOrder(q)} LIMIT ? OFFSET ?`)
    .all(roundId, roundId, ...where.params, q.pageSize, (page - 1) * q.pageSize) as AdminRow[];
  return { rows, total, page, pages };
}

/** Coverage numbers without loading the round. */
export function roundCoverage(roundId: number) {
  const sqlite = getSqlite();
  const total = countDomains(roundId);
  const viewed = (
    sqlite.prepare("SELECT COUNT(DISTINCT domain_id) AS n FROM views WHERE round_id = ?").get(roundId) as { n: number }
  ).n;
  return { total, viewed };
}

/** Per-provider counts and votes inside one round, for the results filter chips. */
export function roundProviderCounts(roundId: number) {
  return getSqlite()
    .prepare(
      `SELECT p.dns_parking_provider AS provider, COUNT(*) AS count, COALESCE(SUM(v.votes), 0) AS votes
       FROM domains d
       LEFT JOIN pool p ON p.name = d.pool_name
       LEFT JOIN (SELECT domain_id, COUNT(*) AS votes FROM votes WHERE round_id = ? GROUP BY domain_id) v ON v.domain_id = d.id
       WHERE d.round_id = ?
       GROUP BY p.dns_parking_provider
       ORDER BY count DESC`,
    )
    .all(roundId, roundId) as Array<{ provider: string | null; count: number; votes: number }>;
}

/** Streams every row of a round for CSV export. */
export function iterateRoundRows(roundId: number) {
  return getSqlite()
    .prepare(`${ROW_SELECT} ${ROW_FROM} WHERE d.round_id = ? ORDER BY d.position`)
    .iterate(roundId, roundId, roundId) as IterableIterator<AdminRow>;
}

export type PickRow = {
  name: string;
  note: string | null;
  createdAt: number;
  price: number | null;
  currency: string | null;
  provider: string | null;
  nsClass: string | null;
  evidence: string | null;
  marketplace: string | null;
  url: string | null;
  bestSource: string | null;
  votes: number;
  voters: number;
  rounds: number;
};

/** Curated picks with tallies summed over every round and every voter. */
export function listPicks() {
  return getSqlite()
    .prepare(
      `SELECT k.name, k.note, k.created_at AS createdAt,
              COALESCE(p.lp_price, p.best_price) AS price, p.lp_currency AS currency,
              p.dns_parking_provider AS provider, p.dns_ns_class AS nsClass, p.evidence,
              p.lp_marketplace AS marketplace, p.lp_url AS url, p.best_source AS bestSource,
              COALESCE(t.votes, 0) AS votes, COALESCE(t.voters, 0) AS voters, COALESCE(t.rounds, 0) AS rounds
       FROM picks k
       LEFT JOIN pool p ON p.name = k.name
       LEFT JOIN (
         SELECT d.name, COUNT(v.id) AS votes, COUNT(DISTINCT v.user_id) AS voters, COUNT(DISTINCT d.round_id) AS rounds
         FROM domains d JOIN votes v ON v.domain_id = d.id
         WHERE d.name IN (SELECT name FROM picks)
         GROUP BY d.name
       ) t ON t.name = k.name
       ORDER BY votes DESC, k.created_at DESC`,
    )
    .all() as PickRow[];
}

/** Top names by votes across all rounds and voters (for the picks page). */
export function topVotedNames(limit = 50) {
  return getSqlite()
    .prepare(
      `SELECT d.name, COUNT(v.id) AS votes, COUNT(DISTINCT v.user_id) AS voters, COUNT(DISTINCT d.round_id) AS rounds,
              MAX(p.lp_url) AS url, MAX(p.dns_parking_provider) AS provider,
              MAX(COALESCE(p.lp_price, p.best_price)) AS price, MAX(p.lp_currency) AS currency,
              MAX(CASE WHEN k.name IS NULL THEN 0 ELSE 1 END) AS picked
       FROM votes v
       JOIN domains d ON d.id = v.domain_id
       LEFT JOIN pool p ON p.name = d.pool_name
       LEFT JOIN picks k ON k.name = d.name
       GROUP BY d.name
       ORDER BY votes DESC, d.name
       LIMIT ?`,
    )
    .all(limit) as Array<{
    name: string;
    votes: number;
    voters: number;
    rounds: number;
    url: string | null;
    provider: string | null;
    price: number | null;
    currency: string | null;
    picked: number;
  }>;
}
