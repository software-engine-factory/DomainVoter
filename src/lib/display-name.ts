import { getSqlite } from "@/db";

/**
 * SQL for the name shown to people: users.display_name when set, else the username.
 * Login, sessions and anything that matches on a user keep using users.username.
 */
export function shownNameSql(alias = "u") {
  return `COALESCE(NULLIF(TRIM(${alias}.display_name), ''), ${alias}.username)`;
}

/** The shown name for one user id, falling back to `fallback` (the session username) if the row is missing. */
export function shownNameFor(userId: number, fallback: string) {
  const row = getSqlite().prepare(`SELECT ${shownNameSql("u")} AS name FROM users u WHERE u.id = ?`).get(userId) as { name: string } | undefined;
  return row?.name ?? fallback;
}
