import { getSqlite } from "@/db";

/**
 * Version of everything the client caches for 12 hours (pool rows, round contents, round list).
 * Derived from data that already exists, so no write path has to remember to bump it:
 * - the latest finished pool import (admin sync/upload),
 * - the newest round id (create / derive / pool round),
 * - how many rounds are closed (closing a round).
 * DATASET_VERSION_SALT lets ops force a purge on every client without touching data.
 */
export function getDatasetVersion() {
  const row = getSqlite()
    .prepare(
      `SELECT
         (SELECT COALESCE(MAX(id), 0) FROM imports WHERE finished_at IS NOT NULL) AS imp,
         (SELECT COALESCE(MAX(id), 0) FROM rounds WHERE creation_job_id IS NULL) AS rnd,
         (SELECT COUNT(*) FROM rounds WHERE status = 'closed' AND creation_job_id IS NULL) AS closed`,
    )
    .get() as { imp: number; rnd: number; closed: number };
  const salt = process.env.DATASET_VERSION_SALT ?? "";
  return `i${row.imp}.r${row.rnd}.c${row.closed}${salt ? `.${salt}` : ""}`;
}
