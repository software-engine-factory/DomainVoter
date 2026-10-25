import { getSqlite } from "@/db";

export type MyBookmark = {
  domainId: number;
  name: string;
  roundId: number;
  roundTitle: string;
  roundOpen: boolean;
  votedAt: number;
};

/** A voter's own bookmarks = the names they voted for, newest first, across every round. */
export function listMyBookmarks(userId: number): MyBookmark[] {
  const rows = getSqlite()
    .prepare(
      `SELECT d.id AS domainId, d.name AS name, r.id AS roundId, r.title AS roundTitle,
              r.status AS status, v.created_at AS votedAt
         FROM votes v
         JOIN domains d ON d.id = v.domain_id
         JOIN rounds r ON r.id = v.round_id
        WHERE v.user_id = ?
        ORDER BY v.created_at DESC`,
    )
    .all(userId) as Array<Omit<MyBookmark, "roundOpen"> & { status: string }>;
  return rows.map(({ status, ...row }) => ({ ...row, roundOpen: status === "open" }));
}
