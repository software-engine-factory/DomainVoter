import fs from "fs";
import Papa from "papaparse";
import { getSqlite } from "@/db";
import { normalizeRow } from "@/lib/pool-import";

/**
 * free_names: candidate .com names that are not registered (from the candidates_*L CSVs).
 * Admin-only reference list: never part of the pool, never shown to voters.
 */
export type FreeRow = { name: string; len: number; sets: string; set4_part: string | null; shape: string | null; ord: number | null; inPool: number };
export type FreeQuery = { len: number | null; set: number | null; q: string; page: number };
export const FREE_PAGE = 100;

const BATCH = 2000;

function int(v: unknown) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.trunc(n) : null;
}

/** Streams a candidates CSV into free_names (upsert by name). Reuses the pool's name/length/set normalisation. */
export function importFreeCsv(file: string, tag: string | null): Promise<{ read: number; upserted: number; skipped: number; error?: string }> {
  const sqlite = getSqlite();
  const now = Date.now();
  const upsert = sqlite.prepare(`INSERT INTO free_names (name, set_1, set_2, set_3, set_4, set_5, set4_part, shape, ord, import_tag, imported_at)
    VALUES (@name, @set_1, @set_2, @set_3, @set_4, @set_5, @set4_part, @shape, @ord, @import_tag, @imported_at)
    ON CONFLICT(name) DO UPDATE SET set_1 = excluded.set_1, set_2 = excluded.set_2, set_3 = excluded.set_3, set_4 = excluded.set_4, set_5 = excluded.set_5,
      set4_part = excluded.set4_part, shape = excluded.shape, ord = excluded.ord, import_tag = coalesce(free_names.import_tag, excluded.import_tag), imported_at = excluded.imported_at`);
  const flush = sqlite.transaction((rows: Record<string, unknown>[]) => rows.forEach((r) => upsert.run(r)));
  const stats = { read: 0, upserted: 0, skipped: 0 };
  let buf: Record<string, unknown>[] = [];
  let error: string | undefined;
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(fs.createReadStream(file, { encoding: "utf8" }) as unknown as File, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase(),
      step(res, parser) {
        stats.read += 1;
        if (stats.read === 1 && !res.meta.fields?.includes("name")) {
          error = "no name column";
          parser.abort();
          return;
        }
        const row = normalizeRow(res.data, now);
        if (!row) {
          stats.skipped += 1;
          return;
        }
        buf.push({
          name: row.name, set_1: row.set_1, set_2: row.set_2, set_3: row.set_3, set_4: row.set_4, set_5: row.set_5,
          set4_part: row.set4_part, shape: row.shape, ord: int(res.data.ord), import_tag: tag ?? row.import_tag ?? null, imported_at: now,
        });
        if (buf.length >= BATCH) {
          flush(buf);
          stats.upserted += buf.length;
          buf = [];
        }
      },
      complete() {
        if (buf.length) {
          flush(buf);
          stats.upserted += buf.length;
        }
        resolve({ ...stats, error });
      },
      error(e) {
        resolve({ ...stats, error: e.message });
      },
    });
  });
}

export function parseFreeQuery(p: Record<string, string | string[] | undefined>): FreeQuery {
  const one = (k: string) => (Array.isArray(p[k]) ? p[k][0] : p[k]) ?? "";
  const len = int(one("len"));
  const set = int(one("set"));
  return {
    len: len && len > 0 && len < 64 ? len : null,
    set: set && [1, 2, 3, 4, 5].includes(set) ? set : null,
    q: one("q").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 63),
    page: Math.max(1, int(one("page")) ?? 1),
  };
}

function where(q: FreeQuery) {
  const w: string[] = [];
  const params: unknown[] = [];
  if (q.len != null) w.push("f.name_len = ?"), params.push(q.len);
  if (q.set != null) w.push(`f.set_${q.set} = 1`);
  if (q.q) w.push("f.name LIKE ?"), params.push(`%${q.q}%`);
  return { sql: w.length ? `WHERE ${w.join(" AND ")}` : "", params };
}

export function browseFree(q: FreeQuery) {
  const sqlite = getSqlite();
  const w = where(q);
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM free_names f ${w.sql}`).get(...w.params) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / FREE_PAGE));
  const page = Math.min(q.page, pages);
  const rows = sqlite
    .prepare(
      `SELECT f.name, f.name_len AS len, f.set4_part, f.shape, f.ord,
         rtrim((CASE WHEN f.set_1 = 1 THEN '1,' ELSE '' END) || (CASE WHEN f.set_3 = 1 THEN '3,' ELSE '' END) || (CASE WHEN f.set_4 = 1 THEN '4,' ELSE '' END) || (CASE WHEN f.set_5 = 1 THEN '5,' ELSE '' END), ',') AS sets,
         EXISTS (SELECT 1 FROM pool p WHERE p.name = f.name) AS inPool
       FROM free_names f ${w.sql} ORDER BY f.name_len, coalesce(f.ord, 1e18), f.name LIMIT ? OFFSET ?`,
    )
    .all(...w.params, FREE_PAGE, (page - 1) * FREE_PAGE) as FreeRow[];
  return { rows, total, page, pages };
}

export function freeLengthCounts() {
  return getSqlite().prepare("SELECT name_len AS length, COUNT(*) AS count FROM free_names GROUP BY name_len ORDER BY name_len").all() as Array<{ length: number; count: number }>;
}
