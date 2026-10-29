import { getSqlite } from "@/db";

export type Assignee = { id: number; username: string };
export type AssignableUser = Assignee & { role: "voter" | "admin" };

/**
 * Round visibility on the voter side: a round with no assignees is visible to everyone; a round with
 * assignees only to them. Admins follow the same rule on the voter side (they always see everything in /admin).
 * `alias` is the SQL alias of the rounds table; binds one parameter (the user id).
 */
export function roundVisibleSql(alias = "r") {
  return `(${alias}.creation_job_id IS NULL AND (NOT EXISTS (SELECT 1 FROM round_assignees ra WHERE ra.round_id = ${alias}.id)
    OR EXISTS (SELECT 1 FROM round_assignees ra WHERE ra.round_id = ${alias}.id AND ra.user_id = ?)))`;
}

export function canSeeRound(roundId: number, userId: number) {
  if (!Number.isInteger(roundId)) return false;
  return !!getSqlite().prepare(`SELECT 1 FROM rounds r WHERE r.id = ? AND ${roundVisibleSql("r")}`).get(roundId, userId);
}

export function listAssignableUsers(): AssignableUser[] {
  return getSqlite().prepare("SELECT id, username, role FROM users ORDER BY role = 'admin', username").all() as AssignableUser[];
}

export function listAssignees(roundId: number): Assignee[] {
  return getSqlite()
    .prepare("SELECT u.id, u.username FROM round_assignees ra JOIN users u ON u.id = ra.user_id WHERE ra.round_id = ? ORDER BY u.username")
    .all(roundId) as Assignee[];
}

/** roundId → assignees, for the admin round list. */
export function assigneesByRound(): Map<number, Assignee[]> {
  const rows = getSqlite()
    .prepare("SELECT ra.round_id AS roundId, u.id, u.username FROM round_assignees ra JOIN users u ON u.id = ra.user_id ORDER BY u.username")
    .all() as Array<Assignee & { roundId: number }>;
  const map = new Map<number, Assignee[]>();
  for (const { roundId, ...user } of rows) map.set(roundId, [...(map.get(roundId) ?? []), user]);
  return map;
}

/** Distinct, existing user ids from a form's `assignees` fields. */
export function parseAssigneeIds(formData: FormData): number[] {
  const ids = [...new Set(formData.getAll("assignees").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];
  const known = new Set(
    (getSqlite().prepare(`SELECT id FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<{ id: number }>).map((r) => r.id),
  );
  return ids.filter((id) => known.has(id));
}

/** Replaces a round's assignees (empty list = visible to everyone). */
export function setRoundAssignees(roundId: number, userIds: number[]) {
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM round_assignees WHERE round_id = ?").run(roundId);
    const insert = sqlite.prepare("INSERT OR IGNORE INTO round_assignees (round_id, user_id) VALUES (?, ?)");
    for (const id of userIds) insert.run(roundId, id);
  })();
}

export function setBatchAssignees(batchId: number, userIds: number[]) {
  const sqlite = getSqlite();
  sqlite.prepare("DELETE FROM round_batch_assignees WHERE batch_id = ?").run(batchId);
  const insert = sqlite.prepare("INSERT OR IGNORE INTO round_batch_assignees (batch_id, user_id) VALUES (?, ?)");
  for (const id of userIds) insert.run(batchId, id);
}

/** New batch rounds inherit the batch's assignees. */
export function copyBatchAssignees(batchId: number, roundId: number) {
  getSqlite()
    .prepare("INSERT OR IGNORE INTO round_assignees (round_id, user_id) SELECT ?, user_id FROM round_batch_assignees WHERE batch_id = ?")
    .run(roundId, batchId);
}
