import { getSqlite } from "@/db";
import { shownNameSql } from "@/lib/display-name";
import { t } from "@/lib/copy/fa";

export const PICK_STATUSES = ["shortlist", "contacted", "bought", "bonus_paid", "passed"] as const;
export type PickStatus = (typeof PICK_STATUSES)[number];

export const PICK_STATUS_LABELS: Record<PickStatus, string> = {
  shortlist: t.bookmarkStatus.shortlist,
  contacted: t.bookmarkStatus.contacted,
  bought: t.bookmarkStatus.bought,
  bonus_paid: t.bookmarkStatus.bonus_paid,
  passed: t.bookmarkStatus.passed,
};

/**
 * Freezes who had chosen this name right now. Admin-only: nothing here is visible to voters,
 * and no voter-facing page reads picks or pick_provenance.
 */
export function captureProvenance(name: string) {
  getSqlite()
    .prepare(
      `INSERT INTO pick_provenance (name, user_id, round_id, domain_id, voted_at, captured_at)
       SELECT lower(d.name), v.user_id, d.round_id, d.id, v.created_at, ?
       FROM votes v JOIN domains d ON d.id = v.domain_id
       WHERE lower(d.name) = ?
       ON CONFLICT(name, user_id, round_id) DO NOTHING`,
    )
    .run(Date.now(), name);
}

export function isBookmarked(name: string) {
  return !!getSqlite().prepare("SELECT 1 FROM picks WHERE name = ?").get(name);
}

export function addBookmark(name: string, adminId: number, sourceUserId: number | null, note: string | null) {
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `INSERT INTO picks (name, note, created_at, created_by, status, source_user_id, updated_at)
         VALUES (?, ?, ?, ?, 'shortlist', ?, ?)
         ON CONFLICT(name) DO UPDATE SET source_user_id = COALESCE(picks.source_user_id, excluded.source_user_id)`,
      )
      .run(name, note, Date.now(), adminId, sourceUserId, Date.now());
    captureProvenance(name);
  })();
}

export function removeBookmark(name: string) {
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM picks WHERE name = ?").run(name);
    sqlite.prepare("DELETE FROM pick_provenance WHERE name = ?").run(name);
  })();
}

export function updateBookmark(name: string, input: { status?: string; bonusUserId?: number | null; note?: string | null }) {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [Date.now()];
  if (input.status && (PICK_STATUSES as readonly string[]).includes(input.status)) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.bonusUserId !== undefined) {
    sets.push("bonus_user_id = ?");
    params.push(input.bonusUserId);
  }
  if (input.note !== undefined) {
    sets.push("note = ?");
    params.push(input.note);
  }
  getSqlite().prepare(`UPDATE picks SET ${sets.join(", ")} WHERE name = ?`).run(...params, name);
}

export type BookmarkRow = {
  name: string;
  note: string | null;
  createdAt: number;
  status: PickStatus;
  sourceUserId: number | null;
  sourceUsername: string | null;
  bonusUserId: number | null;
  bonusUsername: string | null;
  price: number | null;
  currency: string | null;
  provider: string | null;
  marketplace: string | null;
  url: string | null;
  evidence: string | null;
};

export function listBookmarks(filter: { status?: string; userId?: number | null; q?: string } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status && (PICK_STATUSES as readonly string[]).includes(filter.status)) {
    where.push("k.status = ?");
    params.push(filter.status);
  }
  if (filter.userId) {
    where.push(
      `(k.source_user_id = ? OR EXISTS (SELECT 1 FROM pick_provenance pp WHERE pp.name = k.name AND pp.user_id = ?)
        OR EXISTS (SELECT 1 FROM votes v JOIN domains d ON d.id = v.domain_id WHERE lower(d.name) = k.name AND v.user_id = ?))`,
    );
    params.push(filter.userId, filter.userId, filter.userId);
  }
  if (filter.q) {
    where.push("k.name LIKE ?");
    params.push(`%${filter.q.toLowerCase()}%`);
  }
  return getSqlite()
    .prepare(
      `SELECT k.name, k.note, k.created_at AS createdAt, k.status, k.source_user_id AS sourceUserId, ${shownNameSql("su")} AS sourceUsername,
              k.bonus_user_id AS bonusUserId, ${shownNameSql("bu")} AS bonusUsername,
              COALESCE(p.lp_price, p.best_price) AS price, p.lp_currency AS currency, p.dns_parking_provider AS provider,
              p.lp_marketplace AS marketplace, p.lp_url AS url, p.evidence
       FROM picks k
       LEFT JOIN users su ON su.id = k.source_user_id
       LEFT JOIN users bu ON bu.id = k.bonus_user_id
       LEFT JOIN pool p ON p.name = k.name
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY k.created_at DESC`,
    )
    .all(...params) as BookmarkRow[];
}
