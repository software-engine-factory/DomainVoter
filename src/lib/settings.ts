import { getSqlite } from "@/db";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageSize } from "@/lib/vote-view";

const VOTE_PAGE_SIZE_KEY = "vote_page_size";

/** Names per page on the voter grid, set by admins (تنظیمات نمایش). Falls back to the default. */
export function getVotePageSize(): PageSize {
  const row = getSqlite().prepare("SELECT value FROM app_settings WHERE key = ?").get(VOTE_PAGE_SIZE_KEY) as
    | { value: string }
    | undefined;
  const n = Number(row?.value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
}

export function setVotePageSize(size: number, userId: number) {
  if (!(PAGE_SIZES as readonly number[]).includes(size)) throw new Error("bad size");
  getSqlite()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(VOTE_PAGE_SIZE_KEY, String(size), Date.now(), userId);
}
