import { hasFilters, patternActive, type VoteView } from "@/lib/vote-view";
import { eq } from "drizzle-orm";
import { roundVisibleSql } from "@/lib/assignees";
import { getDb, getSqlite } from "@/db";
import { rounds } from "@/db/schema";
import type { RoundFilters } from "@/lib/filters";
import { poolOrder, poolWhere, type PoolFilters } from "@/lib/pool";
import { ensureFunctions } from "@/lib/batches";


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

/** All rounds (admin). With `visibleTo`, only the rounds that user may see on the voter side. */
export function listRounds(visibleTo?: number): RoundListItem[] {
  const visible = visibleTo === undefined ? "" : `WHERE ${roundVisibleSql("r")}`;
  return getSqlite()
    .prepare(
      `SELECT r.id, r.title, r.status, r.parent_round_id AS parentRoundId, p.title AS parentTitle,
              r.created_at AS createdAt,
              (SELECT COUNT(*) FROM domains d WHERE d.round_id = r.id) AS domainCount,
              (SELECT COUNT(DISTINCT v.domain_id) FROM views v WHERE v.round_id = r.id) AS viewedCount
       FROM rounds r
       LEFT JOIN rounds p ON p.id = r.parent_round_id
       ${visible}
       ORDER BY r.id DESC`,
    )
    .all(...(visibleTo === undefined ? [] : [visibleTo])) as RoundListItem[];
}

export function listOpenRounds(userId: number): RoundListItem[] {
  return listRounds(userId).filter((round) => round.status === "open");
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
export function createRoundFromPool(title: string, filters: PoolFilters, seed?: string | null) {
  const sqlite = getSqlite();
  const where = poolWhere(filters);
  const seeded = filters.order === "random" && !!seed;
  if (seeded) ensureFunctions();
  const order = seeded ? "dv_seeded_rank(?, p.name), p.name" : poolOrder(filters.order);
  const orderParams = seeded ? [seed] : [];
  return sqlite.transaction(() => {
    const now = Date.now();
    const info = sqlite
      .prepare(
        `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source)
         VALUES (?, 'open', NULL, ?, ?, ?, ?, 'pool')`,
      )
      .run(title, JSON.stringify(seeded ? { ...filters, seed } : filters), filters.order, now, now);
    const id = Number(info.lastInsertRowid);
    const inserted = sqlite
      .prepare(
        `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency)
         SELECT ?, ROW_NUMBER() OVER (ORDER BY ${order}), p.name, COALESCE(p.lp_price, p.best_price), 0, NULL, p.name, p.lp_currency
         FROM pool p ${where.sql}
         ORDER BY ${order}`,
      )
      .run(id, ...orderParams, ...where.params, ...orderParams);
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
  LEFT JOIN picks k ON k.name = lower(d.name)
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
       LEFT JOIN picks k ON k.name = lower(d.name)
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

export type VoteCard = { id: number; name: string; price: number | null; currency: string | null; url: string | null };
export type VoteCardsPage = {
  cards: VoteCard[];
  /** Names matching the view (inside the position range), across the whole round. */
  matched: number;
  page: number;
  pages: number;
  from: number;
  to: number;
  /** 1-based index of the first card within the matched list. */
  offset: number;
};

function likeEscape(value: string) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * One page of the voter grid, filtered server-side across the whole round. Pattern "_" = any char,
 * matched against the label (the part before the first dot). Prices come from the pool (the live
 * sale price), falling back to the round row; marketplace and parking provider stay admin-only.
 */
export function queryVoteCards(roundId: number, view: VoteView, total = countDomains(roundId)): VoteCardsPage {
  const from = Math.min(Math.max(view.from ?? 1, 1), Math.max(total, 1));
  const to = Math.max(Math.min(view.to ?? total, total), from);
  const where = ["d.round_id = ?", "d.position >= ?", "d.position <= ?"];
  const params: Array<string | number> = [roundId, from, to];
  if (view.q) {
    where.push("d.name LIKE ? ESCAPE '\\'");
    params.push(`%${likeEscape(view.q)}%`);
  }
  if (patternActive(view.pat, view.exact)) {
    // "_" is LIKE's single-char wildcard already; the pattern only holds [a-z0-9-_].
    const labelLen = "(instr(d.name || '.', '.') - 1)";
    if (view.exact) {
      where.push(`${labelLen} = ?`, "d.name LIKE ?");
      params.push(view.pat.length, `${view.pat}%`);
    } else {
      // The label must reach the last fixed position, so "_" never matches the dot or the TLD.
      where.push(`${labelLen} >= ?`, "d.name LIKE ?");
      params.push(view.pat.length, `${view.pat}%`);
    }
  }
  const sqlite = getSqlite();
  const clause = where.join(" AND ");
  const filtered = hasFilters(view);
  const matched = filtered
    ? (sqlite.prepare(`SELECT COUNT(*) AS n FROM domains d WHERE ${clause}`).get(...params) as { n: number }).n
    : total === 0 ? 0 : to - from + 1;
  const pages = Math.max(1, Math.ceil(matched / view.size));
  const page = Math.min(Math.max(view.page, 1), pages);
  const offsetRows = (page - 1) * view.size;
  const cards =
    matched === 0
      ? []
      : (sqlite
          .prepare(
            `SELECT d.id, d.name, COALESCE(p.lp_price, p.best_price, d.price) AS price,
                    COALESCE(p.lp_currency, d.currency) AS currency, p.lp_url AS url
             FROM domains d LEFT JOIN pool p ON p.name = d.pool_name
             WHERE ${clause}
             ORDER BY d.position ASC
             LIMIT ? OFFSET ?`,
          )
          .all(...params, view.size, offsetRows) as VoteCard[]);
  return { cards, matched, page, pages, from, to, offset: offsetRows + 1 };
}

export function renameRound(roundId: number, title: string) {
  getSqlite().prepare("UPDATE rounds SET title = ? WHERE id = ?").run(title, roundId);
}

export type NextRule = { mode: "min" | "top"; n: number; carryAssignees: boolean };

const VOTES_OF = `(SELECT domain_id, COUNT(*) AS votes FROM votes WHERE round_id = ? GROUP BY domain_id)`;

/** How many names a "next round" rule would carry over (top N counts only names with ≥1 vote). */
export function countNext(roundId: number, rule: Pick<NextRule, "mode" | "n">) {
  const sqlite = getSqlite();
  if (rule.mode === "top") {
    const voted = (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${VOTES_OF}`).get(roundId) as { n: number }).n;
    return Math.min(voted, rule.n);
  }
  return (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM domains d JOIN ${VOTES_OF} v ON v.domain_id = d.id WHERE d.round_id = ? AND v.votes >= ?`).get(roundId, roundId, rule.n) as {
      n: number;
    }
  ).n;
}

/** One click: a new open round with the names voted on in `parentId`, most votes first. */
export function createNextRound(parentId: number, title: string, rule: NextRule) {
  const sqlite = getSqlite();
  const parent = getRound(parentId);
  if (!parent) return { id: 0, count: 0 };
  const order = "v.votes DESC, d.position ASC";
  return sqlite.transaction(() => {
    const now = Date.now();
    const info = sqlite
      .prepare(
        `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source, next_rule)
         VALUES (?, 'open', ?, ?, 'votes', ?, ?, ?, ?)`,
      )
      .run(
        title,
        parentId,
        JSON.stringify({ minVotes: rule.mode === "min" ? rule.n : 1, maxVotes: null, premium: "any", minPrice: null, maxPrice: null, sort: "votes" }),
        now,
        now,
        parent.source ?? "csv",
        JSON.stringify(rule),
      );
    const id = Number(info.lastInsertRowid);
    const where = rule.mode === "min" ? "v.votes >= ?" : "v.votes >= 1";
    const limit = rule.mode === "top" ? `LIMIT ${Math.floor(rule.n)}` : "";
    const inserted = sqlite
      .prepare(
        `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency)
         SELECT ?, ROW_NUMBER() OVER (ORDER BY votes DESC, position ASC), name, price, is_premium, id, pool_name, currency
         FROM (
           SELECT d.id, d.position, d.name, d.price, d.is_premium, d.pool_name, d.currency, v.votes
           FROM domains d JOIN ${VOTES_OF} v ON v.domain_id = d.id
           WHERE d.round_id = ? AND ${where}
           ORDER BY ${order} ${limit}
         )
         ORDER BY votes DESC, position ASC`,
      )
      .run(id, parentId, parentId, ...(rule.mode === "min" ? [rule.n] : []));
    if (inserted.changes === 0) {
      sqlite.prepare("DELETE FROM rounds WHERE id = ?").run(id);
      return { id: 0, count: 0 };
    }
    if (rule.carryAssignees) {
      sqlite.prepare("INSERT OR IGNORE INTO round_assignees (round_id, user_id) SELECT ?, user_id FROM round_assignees WHERE round_id = ?").run(id, parentId);
    }
    return { id, count: inserted.changes };
  })();
}

export type FunnelStep = { id: number; title: string; status: "open" | "closed"; count: number; voted: number };

/** The chain this round sits in: root → … → this round → its first child → … (each step clickable). */
export function roundFunnel(roundId: number): FunnelStep[] {
  const sqlite = getSqlite();
  const step = sqlite.prepare(
    `SELECT r.id, r.title, r.status, r.parent_round_id AS parentId,
            (SELECT COUNT(*) FROM domains d WHERE d.round_id = r.id) AS count,
            (SELECT COUNT(DISTINCT domain_id) FROM votes v WHERE v.round_id = r.id) AS voted
     FROM rounds r WHERE r.id = ?`,
  );
  const child = sqlite.prepare("SELECT id FROM rounds WHERE parent_round_id = ? ORDER BY id DESC LIMIT 1");
  type Row = FunnelStep & { parentId: number | null };
  const chain: Row[] = [];
  const seen = new Set<number>();
  let cur = step.get(roundId) as Row | undefined;
  while (cur && !seen.has(cur.id)) {
    chain.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentId ? (step.get(cur.parentId) as Row | undefined) : undefined;
  }
  let next = child.get(roundId) as { id: number } | undefined;
  while (next && !seen.has(next.id)) {
    const row = step.get(next.id) as Row;
    chain.push(row);
    seen.add(row.id);
    next = child.get(row.id) as { id: number } | undefined;
  }
  return chain.map(({ parentId: _p, ...rest }) => { void _p; return rest; });
}
