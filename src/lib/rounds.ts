import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { rounds } from "@/db/schema";
import { applyFilters, type RoundFilters } from "@/lib/filters";

export type DomainStat = {
  id: number;
  position: number;
  name: string;
  price: number | null;
  isPremium: boolean;
  sourceDomainId: number | null;
  votes: number;
  viewers: number;
};

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

type RawStat = {
  id: number;
  position: number;
  name: string;
  price: number | null;
  isPremium: number;
  sourceDomainId: number | null;
  votes: number;
  viewers: number;
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
              COUNT(DISTINCT d.id) AS domainCount,
              COUNT(DISTINCT CASE WHEN v.domain_id IS NOT NULL THEN d.id END) AS viewedCount
       FROM rounds r
       LEFT JOIN rounds p ON p.id = r.parent_round_id
       LEFT JOIN domains d ON d.round_id = r.id
       LEFT JOIN views v ON v.domain_id = d.id
       GROUP BY r.id
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

export function getDomainStats(roundId: number): DomainStat[] {
  const rows = getSqlite()
    .prepare(
      `SELECT d.id, d.position, d.name, d.price, d.is_premium AS isPremium,
              d.source_domain_id AS sourceDomainId,
              COALESCE(v.votes, 0) AS votes,
              COALESCE(w.viewers, 0) AS viewers
       FROM domains d
       LEFT JOIN (
         SELECT domain_id, COUNT(*) AS votes FROM votes WHERE round_id = ? GROUP BY domain_id
       ) v ON v.domain_id = d.id
       LEFT JOIN (
         SELECT domain_id, COUNT(*) AS viewers FROM views WHERE round_id = ? GROUP BY domain_id
       ) w ON w.domain_id = d.id
       WHERE d.round_id = ?
       ORDER BY d.position ASC`,
    )
    .all(roundId, roundId, roundId) as RawStat[];

  return rows.map((row) => ({ ...row, isPremium: row.isPremium === 1 }));
}

export function getVoteCards(roundId: number, start: number, end: number) {
  const rows = getSqlite()
    .prepare(
      `SELECT id, position, name, price, is_premium AS isPremium
       FROM domains
       WHERE round_id = ? AND position >= ? AND position <= ?
       ORDER BY position ASC`,
    )
    .all(roundId, start, end) as Array<{
    id: number;
    position: number;
    name: string;
    price: number | null;
    isPremium: number;
  }>;

  return rows.map((row) => ({ ...row, isPremium: row.isPremium === 1 }));
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
      `SELECT d.position, d.name, d.price, d.is_premium AS isPremium
       FROM votes v
       JOIN domains d ON d.id = v.domain_id
       WHERE v.round_id = ? AND v.user_id = ?
       ORDER BY d.position ASC`,
    )
    .all(roundId, userId) as Array<{
    position: number;
    name: string;
    price: number | null;
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

export function matchingDomains(roundId: number, filters: RoundFilters) {
  return applyFilters(getDomainStats(roundId), filters);
}
