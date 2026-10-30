import { getSqlite } from "@/db";
import { shownNameSql } from "@/lib/display-name";
import { normalizeSetIds, setSumsSql } from "@/lib/sets";

/** Day buckets follow the team's clock (Tbilisi, UTC+4) unless STATS_TZ_OFFSET_MINUTES says otherwise. */
export const TZ_OFFSET_MS = Number(process.env.STATS_TZ_OFFSET_MINUTES ?? 240) * 60_000;
const DAY_SQL = (column: string) => `date((${column} + ${TZ_OFFSET_MS}) / 1000, 'unixepoch')`;

export type UserStat = {
  id: number;
  /** Shown name (display name, else username). */
  username: string;
  /** Login username. */
  login: string;
  role: string;
  createdAt: number;
  views: number;
  votes: number;
  rounds: number;
  firstSeen: number | null;
  lastSeen: number | null;
  views24h: number;
  activeDays: number;
  bookmarkedHits: number;
};

/** One row per voter: how much they looked at, how much they chose, and how many of their choices the admin bookmarked. */
export function listUserStats(): UserStat[] {
  return getSqlite()
    .prepare(
      `SELECT u.id, ${shownNameSql("u")} AS username, u.username AS login, u.role, u.created_at AS createdAt,
              COALESCE(w.views, 0) AS views, COALESCE(v.votes, 0) AS votes, COALESCE(w.rounds, 0) AS rounds,
              w.firstSeen, w.lastSeen, COALESCE(w.views24h, 0) AS views24h, COALESCE(w.activeDays, 0) AS activeDays,
              COALESCE(h.hits, 0) AS bookmarkedHits
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS views, COUNT(DISTINCT round_id) AS rounds, MIN(viewed_at) AS firstSeen,
                MAX(viewed_at) AS lastSeen, SUM(CASE WHEN viewed_at >= ? THEN 1 ELSE 0 END) AS views24h,
                COUNT(DISTINCT ${DAY_SQL("viewed_at")}) AS activeDays
         FROM views GROUP BY user_id
       ) w ON w.user_id = u.id
       LEFT JOIN (SELECT user_id, COUNT(*) AS votes FROM votes GROUP BY user_id) v ON v.user_id = u.id
       LEFT JOIN (
         SELECT v.user_id, COUNT(DISTINCT d.name) AS hits
         FROM votes v JOIN domains d ON d.id = v.domain_id JOIN picks k ON k.name = lower(d.name)
         GROUP BY v.user_id
       ) h ON h.user_id = u.id
       ORDER BY bookmarkedHits DESC, votes DESC, views DESC, username`,
    )
    .all(Date.now() - 86_400_000) as UserStat[];
}

export function getUser(id: number) {
  if (!Number.isInteger(id)) return undefined;
  return getSqlite().prepare(`SELECT u.id, ${shownNameSql("u")} AS username, u.username AS login, u.role, u.created_at AS createdAt FROM users u WHERE u.id = ?`).get(id) as
    | { id: number; username: string; login: string; role: string; createdAt: number }
    | undefined;
}

export function userRounds(userId: number) {
  return getSqlite()
    .prepare(
      `SELECT r.id, r.title, r.status, r.batch_id AS batchId, r.batch_index AS batchIndex,
              (SELECT COUNT(*) FROM domain_catalog d WHERE d.round_id = r.id) AS size,
              COUNT(w.id) AS views, MIN(w.viewed_at) AS firstSeen, MAX(w.viewed_at) AS lastSeen,
              MIN(dw.position) AS minPos, MAX(dw.position) AS maxPos,
              (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id AND v.user_id = ?) AS votes
       FROM views w
       JOIN rounds r ON r.id = w.round_id
       JOIN domains dw ON dw.id = w.domain_id
       WHERE w.user_id = ?
       GROUP BY r.id
       ORDER BY lastSeen DESC`,
    )
    .all(userId, userId) as Array<{
    id: number;
    title: string;
    status: string;
    batchId: number | null;
    batchIndex: number | null;
    size: number;
    views: number;
    firstSeen: number;
    lastSeen: number;
    minPos: number;
    maxPos: number;
    votes: number;
  }>;
}

/** Which pool sets (and nameserver classes) the names a user looked at came from. */
export function userSetCoverage(userId: number) {
  return getSqlite()
    .prepare(
      `SELECT COUNT(*) AS viewed,
              ${setSumsSql("p")},
              SUM(CASE WHEN p.evidence = 'sale_page' THEN 1 ELSE 0 END) AS salePage,
              SUM(CASE WHEN p.evidence = 'nameserver' THEN 1 ELSE 0 END) AS nameserver
       FROM views w JOIN domains d ON d.id = w.domain_id LEFT JOIN pool p ON p.name = d.pool_name
       WHERE w.user_id = ?`,
    )
    .get(userId) as Record<string, number | null>;
}

export type ActivityKind = "view" | "vote";
export type ActivityQuery = {
  kind: "all" | ActivityKind;
  userId?: number | null;
  roundId?: number | null;
  q?: string;
  from?: string; // YYYY-MM-DD, team day
  to?: string;
  set?: number | null;
  provider?: string;
  evidence?: string;
  bookmarkedOnly?: boolean;
  votedOnly?: boolean;
  group: "event" | "name" | "user";
  page: number;
  pageSize: number;
};

export type ActivityRow = {
  kind: ActivityKind;
  at: number;
  userId: number;
  username: string;
  roundId: number;
  roundTitle: string;
  domainId: number;
  position: number;
  name: string;
  provider: string | null;
  evidence: string | null;
  price: number | null;
  currency: string | null;
  url: string | null;
  voted: number;
  bookmarked: number;
};

function dayStart(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Date.parse(`${value}T00:00:00Z`) - TZ_OFFSET_MS;
}

/** One SQL source of truth for the explorer, the per-user page and the CSV export. */
function activitySource(q: ActivityQuery) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const sel = (kind: ActivityKind, table: string, time: string) => {
    const where: string[] = [];
    const p: unknown[] = [];
    if (q.userId) {
      where.push("e.user_id = ?");
      p.push(q.userId);
    }
    if (q.roundId) {
      where.push("e.round_id = ?");
      p.push(q.roundId);
    }
    const start = dayStart(q.from);
    const end = dayStart(q.to);
    if (start != null) {
      where.push(`e.${time} >= ?`);
      p.push(start);
    }
    if (end != null) {
      where.push(`e.${time} < ?`);
      p.push(end + 86_400_000);
    }
    if (q.q) {
      where.push("d.name LIKE ?");
      p.push(`%${q.q.toLowerCase()}%`);
    }
    const set = q.set ? normalizeSetIds([q.set])[0] : undefined;
    if (set) where.push(`p.set_${set} = 1`);
    if (q.provider) {
      if (q.provider === "__none__") where.push("p.dns_parking_provider IS NULL");
      else {
        where.push("p.dns_parking_provider = ?");
        p.push(q.provider);
      }
    }
    if (q.evidence) {
      where.push("p.evidence = ?");
      p.push(q.evidence);
    }
    if (q.bookmarkedOnly) where.push("k.name IS NOT NULL");
    if (q.votedOnly) where.push("vv.id IS NOT NULL");
    parts.push(
      `SELECT '${kind}' AS kind, e.${time} AS at, e.user_id AS userId, ${shownNameSql("u")} AS username, e.round_id AS roundId, r.title AS roundTitle,
              d.id AS domainId, d.position, d.name, p.dns_parking_provider AS provider, p.evidence,
              COALESCE(p.lp_price, p.best_price, d.price) AS price, COALESCE(p.lp_currency, d.currency) AS currency, p.lp_url AS url,
              CASE WHEN vv.id IS NULL THEN 0 ELSE 1 END AS voted, CASE WHEN k.name IS NULL THEN 0 ELSE 1 END AS bookmarked
       FROM ${table} e
       JOIN users u ON u.id = e.user_id
       JOIN rounds r ON r.id = e.round_id
       JOIN domains d ON d.id = e.domain_id
       LEFT JOIN pool p ON p.name = d.pool_name
       LEFT JOIN picks k ON k.name = lower(d.name)
       LEFT JOIN votes vv ON vv.domain_id = e.domain_id AND vv.user_id = e.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    );
    params.push(...p);
  };
  if (q.kind !== "vote") sel("view", "views", "viewed_at");
  if (q.kind !== "view") sel("vote", "votes", "created_at");
  return { sql: parts.join(" UNION ALL "), params };
}

export function queryActivity(q: ActivityQuery) {
  const sqlite = getSqlite();
  const src = activitySource(q);
  if (q.group === "event") {
    const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM (${src.sql})`).get(...src.params) as { n: number }).n;
    const pages = Math.max(1, Math.ceil(total / q.pageSize));
    const page = Math.min(Math.max(1, q.page), pages);
    const rows = sqlite
      .prepare(`SELECT * FROM (${src.sql}) ORDER BY at DESC, kind DESC LIMIT ? OFFSET ?`)
      .all(...src.params, q.pageSize, (page - 1) * q.pageSize) as ActivityRow[];
    return { group: "event" as const, rows, total, page, pages };
  }
  if (q.group === "name") {
    const grouped = `SELECT name, MAX(provider) AS provider, MAX(evidence) AS evidence, MAX(price) AS price, MAX(currency) AS currency,
             MAX(url) AS url, MAX(bookmarked) AS bookmarked,
             SUM(kind = 'view') AS views, SUM(kind = 'vote') AS votes,
             COUNT(DISTINCT CASE WHEN kind = 'vote' THEN userId END) AS voters,
             GROUP_CONCAT(DISTINCT CASE WHEN kind = 'vote' THEN username END) AS voterNames,
             MIN(CASE WHEN kind = 'vote' THEN at END) AS firstVoteAt,
             MAX(at) AS lastAt
      FROM (${src.sql}) GROUP BY name`;
    const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM (${grouped})`).get(...src.params) as { n: number }).n;
    const pages = Math.max(1, Math.ceil(total / q.pageSize));
    const page = Math.min(Math.max(1, q.page), pages);
    const rows = sqlite
      .prepare(`SELECT * FROM (${grouped}) ORDER BY votes DESC, voters DESC, lastAt DESC LIMIT ? OFFSET ?`)
      .all(...src.params, q.pageSize, (page - 1) * q.pageSize) as Array<{
      name: string;
      provider: string | null;
      evidence: string | null;
      price: number | null;
      currency: string | null;
      url: string | null;
      bookmarked: number;
      views: number;
      votes: number;
      voters: number;
      voterNames: string | null;
      firstVoteAt: number | null;
      lastAt: number;
    }>;
    return { group: "name" as const, rows, total, page, pages };
  }
  const grouped = `SELECT userId, MAX(username) AS username, SUM(kind = 'view') AS views, SUM(kind = 'vote') AS votes,
           COUNT(DISTINCT roundId) AS rounds, SUM(kind = 'vote' AND bookmarked = 1) AS bookmarkedVotes,
           MIN(at) AS firstAt, MAX(at) AS lastAt
    FROM (${src.sql}) GROUP BY userId`;
  const rows = sqlite.prepare(`SELECT * FROM (${grouped}) ORDER BY bookmarkedVotes DESC, votes DESC, views DESC`).all(...src.params) as Array<{
    userId: number;
    username: string;
    views: number;
    votes: number;
    rounds: number;
    bookmarkedVotes: number;
    firstAt: number;
    lastAt: number;
  }>;
  return { group: "user" as const, rows, total: rows.length, page: 1, pages: 1 };
}

export function iterateActivity(q: ActivityQuery) {
  const src = activitySource(q);
  return getSqlite().prepare(`SELECT * FROM (${src.sql}) ORDER BY at DESC`).iterate(...src.params) as IterableIterator<ActivityRow>;
}

export type DailyPoint = { day: string; views: number; votes: number; activeUsers: number; rate: number };

/** Views, votes and active voters per team day, with empty days filled in so charts don't skip. */
export function dailyTotals(days = 30): DailyPoint[] {
  const since = Date.now() - days * 86_400_000;
  const sqlite = getSqlite();
  const views = sqlite
    .prepare(`SELECT ${DAY_SQL("viewed_at")} AS day, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM views WHERE viewed_at >= ? GROUP BY day`)
    .all(since) as Array<{ day: string; n: number; users: number }>;
  const votes = sqlite
    .prepare(`SELECT ${DAY_SQL("created_at")} AS day, COUNT(*) AS n FROM votes WHERE created_at >= ? GROUP BY day`)
    .all(since) as Array<{ day: string; n: number }>;
  const byDay = new Map<string, DailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() + TZ_OFFSET_MS - i * 86_400_000).toISOString().slice(0, 10);
    byDay.set(day, { day, views: 0, votes: 0, activeUsers: 0, rate: 0 });
  }
  for (const row of views) {
    const point = byDay.get(row.day);
    if (point) {
      point.views = row.n;
      point.activeUsers = row.users;
    }
  }
  for (const row of votes) {
    const point = byDay.get(row.day);
    if (point) point.votes = row.n;
  }
  return [...byDay.values()].map((p) => ({ ...p, rate: p.views ? Math.round((p.votes / p.views) * 1000) / 10 : 0 }));
}

/** Views per team day per voter, shaped for a multi-line chart: [{ day, alice: 12, bob: 3 }, …]. */
export function dailyByUser(days = 30, userId?: number) {
  const since = Date.now() - days * 86_400_000;
  const rows = getSqlite()
    .prepare(
      `SELECT ${DAY_SQL("w.viewed_at")} AS day, ${shownNameSql("u")} AS username, COUNT(*) AS n
       FROM views w JOIN users u ON u.id = w.user_id
       WHERE w.viewed_at >= ? ${userId ? "AND w.user_id = ?" : ""}
       GROUP BY day, u.id`,
    )
    .all(...(userId ? [since, userId] : [since])) as Array<{ day: string; username: string; n: number }>;
  const votes = getSqlite()
    .prepare(
      `SELECT ${DAY_SQL("v.created_at")} AS day, ${shownNameSql("u")} AS username, COUNT(*) AS n
       FROM votes v JOIN users u ON u.id = v.user_id
       WHERE v.created_at >= ? ${userId ? "AND v.user_id = ?" : ""}
       GROUP BY day, u.id`,
    )
    .all(...(userId ? [since, userId] : [since])) as Array<{ day: string; username: string; n: number }>;
  const users = [...new Set(rows.map((r) => r.username))].sort();
  const series: Array<Record<string, string | number>> = [];
  const index = new Map<string, Record<string, string | number>>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() + TZ_OFFSET_MS - i * 86_400_000).toISOString().slice(0, 10);
    const point: Record<string, string | number> = { day };
    for (const u of users) point[u] = 0;
    index.set(day, point);
    series.push(point);
  }
  for (const r of rows) {
    const point = index.get(r.day);
    if (point) point[r.username] = r.n;
  }
  const voteSeries = series.map((p) => ({ day: p.day as string, votes: 0, views: users.reduce((s, u) => s + Number(p[u] ?? 0), 0) }));
  const vIndex = new Map(voteSeries.map((p) => [p.day, p]));
  for (const r of votes) {
    const point = vIndex.get(r.day);
    if (point) point.votes += r.n;
  }
  return { users, series, voteSeries };
}

/** Views per hour of the team day: when people actually look. */
export function hourlyProfile(userId?: number) {
  const rows = getSqlite()
    .prepare(
      `SELECT CAST(strftime('%H', (viewed_at + ${TZ_OFFSET_MS}) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS views
       FROM views ${userId ? "WHERE user_id = ?" : ""} GROUP BY hour`,
    )
    .all(...(userId ? [userId] : [])) as Array<{ hour: number; views: number }>;
  const out = Array.from({ length: 24 }, (_, hour) => ({ hour, views: 0 }));
  for (const r of rows) out[r.hour].views = r.views;
  return out;
}

export function overallTotals() {
  return getSqlite()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM views) AS views, (SELECT COUNT(*) FROM votes) AS votes,
              (SELECT COUNT(DISTINCT domain_id) FROM views) AS distinctViewed,
              (SELECT COUNT(DISTINCT user_id) FROM views) AS activeUsers,
              (SELECT COUNT(*) FROM users) AS voters,
              (SELECT COUNT(*) FROM views WHERE viewed_at >= ?) AS views24h,
              (SELECT COUNT(*) FROM votes WHERE created_at >= ?) AS votes24h,
              (SELECT COUNT(*) FROM picks) AS bookmarks`,
    )
    .get(Date.now() - 86_400_000, Date.now() - 86_400_000) as Record<string, number>;
}

/** Everyone who has chosen a name, live from votes, merged with what was captured when it was bookmarked. */
export function nameProvenance(names: string[]) {
  if (names.length === 0) return new Map<string, ProvenanceEntry[]>();
  const placeholders = names.map(() => "?").join(", ");
  const rows = getSqlite()
    .prepare(
      `SELECT name, userId, username, roundId, roundTitle, MIN(votedAt) AS votedAt, MAX(live) AS live, MAX(captured) AS captured FROM (
         SELECT lower(d.name) AS name, v.user_id AS userId, ${shownNameSql("u")} AS username, d.round_id AS roundId, r.title AS roundTitle, v.created_at AS votedAt, 1 AS live, 0 AS captured
         FROM votes v JOIN domains d ON d.id = v.domain_id JOIN users u ON u.id = v.user_id JOIN rounds r ON r.id = d.round_id
         WHERE lower(d.name) IN (${placeholders})
         UNION ALL
         SELECT pp.name, pp.user_id, ${shownNameSql("u")}, pp.round_id, r.title, pp.voted_at, 0, 1
         FROM pick_provenance pp JOIN users u ON u.id = pp.user_id LEFT JOIN rounds r ON r.id = pp.round_id
         WHERE pp.name IN (${placeholders})
       ) GROUP BY name, userId, roundId ORDER BY votedAt ASC`,
    )
    .all(...names, ...names) as Array<ProvenanceEntry & { name: string }>;
  const out = new Map<string, ProvenanceEntry[]>();
  for (const row of rows) {
    const list = out.get(row.name) ?? [];
    list.push(row);
    out.set(row.name, list);
  }
  return out;
}

export type ProvenanceEntry = {
  userId: number;
  username: string;
  roundId: number;
  roundTitle: string | null;
  votedAt: number;
  live: number;
  captured: number;
};

export function voterOptions() {
  return getSqlite().prepare(`SELECT u.id, ${shownNameSql("u")} AS username FROM users u ORDER BY username`).all() as Array<{
    id: number;
    username: string;
  }>;
}

export function roundOptions() {
  return getSqlite().prepare("SELECT id, title FROM rounds ORDER BY id DESC").all() as Array<{ id: number; title: string }>;
}

export function providerOptions() {
  return getSqlite()
    .prepare("SELECT dns_parking_provider AS value, COUNT(*) AS count FROM pool GROUP BY dns_parking_provider ORDER BY count DESC")
    .all() as Array<{ value: string | null; count: number }>;
}
