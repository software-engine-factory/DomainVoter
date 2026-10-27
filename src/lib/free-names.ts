import fs from "fs";
import Papa from "papaparse";
import { getSqlite } from "@/db";
import { normalizeRow } from "@/lib/pool-import";

/**
 * free_names: candidate .com names that are not registered (from the candidates_*L CSVs).
 * Admin-only reference list: never part of the pool, never shown to voters.
 */
export type FreeRow = {
  name: string; len: number; sets: string; set4_part: string | null; shape: string | null; ord: number | null; inPool: number;
  cf_free: number | null; cf_checked_at: number | null; reg_price_usd: number | null; reg_registrar: string | null;
};
export type FreeQuery = { len: number | null; set: number | null; shape: string | null; cf: boolean; q: string; page: number };
export const FREE_PAGE = 60;
export const VOTER_FREE_PAGE = 120;

/** Rows per transaction, and rows per multi-row INSERT statement (16 params each, well under SQLite's 32766). */
const BATCH = 10000;
const CHUNK = 500;
const COLS = ["name", "set_1", "set_2", "set_3", "set_4", "set_5", "set4_part", "shape", "ord", "import_tag", "imported_at", "cf_free", "cf_checked_at", "reg_price_usd", "reg_registrar"] as const;

function num(v: unknown) {
  const s = String(v ?? "").trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}
function bool01(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "free"].includes(s)) return 1;
  if (["0", "false", "no", "n", "taken"].includes(s)) return 0;
  return null;
}
/** cf_checked_at: epoch seconds/ms or an ISO date → epoch ms. */
function when(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}

/** Register links, built in-app (never stored). `name` is the full domain, e.g. "qzx.com". */
export function registerLinks(name: string) {
  const d = encodeURIComponent(name.toLowerCase());
  return {
    cloudflare: `https://domains.cloudflare.com/?domain=${d}`,
    namecheap: `https://www.namecheap.com/domains/registration/results/?domain=${d}`,
    godaddy: `https://www.godaddy.com/domainsearch/find?domainToCheck=${d}`,
  };
}

function int(v: unknown) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.trunc(n) : null;
}

/** Streams a candidates CSV into free_names (upsert by name). Reuses the pool's name/length/set normalisation. */
export function importFreeCsv(file: string, tag: string | null): Promise<{ read: number; upserted: number; skipped: number; error?: string }> {
  const sqlite = getSqlite();
  const now = Date.now();
  const upsertSql = (n: number) =>
    `INSERT INTO free_names (${COLS.join(", ")}) VALUES ${Array(n).fill(`(${COLS.map(() => "?").join(",")})`).join(",")}
    ON CONFLICT(name) DO UPDATE SET set_1 = excluded.set_1, set_2 = excluded.set_2, set_3 = excluded.set_3, set_4 = excluded.set_4, set_5 = excluded.set_5,
      set4_part = excluded.set4_part, shape = excluded.shape, ord = excluded.ord, import_tag = coalesce(free_names.import_tag, excluded.import_tag), imported_at = excluded.imported_at,
      cf_free = coalesce(excluded.cf_free, free_names.cf_free), cf_checked_at = coalesce(excluded.cf_checked_at, free_names.cf_checked_at),
      reg_price_usd = coalesce(excluded.reg_price_usd, free_names.reg_price_usd), reg_registrar = coalesce(excluded.reg_registrar, free_names.reg_registrar)`;
  const full = sqlite.prepare(upsertSql(CHUNK));
  const flush = sqlite.transaction((rows: unknown[][]) => {
    let i = 0;
    for (; i + CHUNK <= rows.length; i += CHUNK) full.run(rows.slice(i, i + CHUNK).flat());
    if (i < rows.length) sqlite.prepare(upsertSql(rows.length - i)).run(rows.slice(i).flat());
  });
  const stats = { read: 0, upserted: 0, skipped: 0 };
  let buf: unknown[][] = [];
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
        const d = res.data;
        const price = num(d.reg_price_usd);
        buf.push([
          row.name, row.set_1, row.set_2, row.set_3, row.set_4, row.set_5, row.set4_part ?? null, row.shape ?? null, int(d.ord),
          tag ?? row.import_tag ?? null, now, bool01(d.cf_free), when(d.cf_checked_at),
          price != null && price >= 0 && price < 1e5 ? Math.round(price * 100) / 100 : null,
          String(d.reg_registrar ?? "").trim().toLowerCase().slice(0, 40) || null,
        ]);
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
    shape: one("shape").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 63) || null,
    cf: one("cf") === "1",
    q: one("q").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 63),
    page: Math.max(1, int(one("page")) ?? 1),
  };
}

function where(q: FreeQuery) {
  const w: string[] = [];
  const params: unknown[] = [];
  if (q.len != null) w.push("f.name_len = ?"), params.push(q.len);
  if (q.set != null) w.push(`f.set_${q.set} = 1`);
  if (q.shape) w.push("f.shape = ?"), params.push(q.shape);
  if (q.cf) w.push("f.cf_free = 1");
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
      `SELECT f.name, f.name_len AS len, f.set4_part, f.shape, f.ord, f.cf_free, f.cf_checked_at, f.reg_price_usd, f.reg_registrar,
         rtrim((CASE WHEN f.set_1 = 1 THEN '1,' ELSE '' END) || (CASE WHEN f.set_3 = 1 THEN '3,' ELSE '' END) || (CASE WHEN f.set_4 = 1 THEN '4,' ELSE '' END) || (CASE WHEN f.set_5 = 1 THEN '5,' ELSE '' END), ',') AS sets,
         EXISTS (SELECT 1 FROM pool p WHERE p.name = f.name) AS inPool
       FROM free_names f ${w.sql} ORDER BY f.name_len, f.ord, f.name LIMIT ? OFFSET ?`,
    )
    .all(...w.params, FREE_PAGE, (page - 1) * FREE_PAGE) as FreeRow[];
  return { rows, total, page, pages };
}

export function freeLengthCounts() {
  return getSqlite().prepare("SELECT name_len AS length, COUNT(*) AS count FROM free_names GROUP BY name_len ORDER BY name_len").all() as Array<{ length: number; count: number }>;
}

/** Shapes (letter patterns) present for a length, most common first, for the filter chips. */
export function freeShapeCounts(len: number | null, limit = 12) {
  if (len == null) return [];
  return getSqlite()
    .prepare("SELECT shape, COUNT(*) AS count FROM free_names WHERE name_len = ? AND shape IS NOT NULL GROUP BY shape ORDER BY count DESC, shape LIMIT ?")
    .all(len, limit) as Array<{ shape: string; count: number }>;
}

/** Voter-facing prototype: names only (no price, no links, no pool flag). */
export function browseFreeNamesOnly(q: Pick<FreeQuery, "len" | "page">) {
  const sqlite = getSqlite();
  const w = q.len != null ? "WHERE name_len = ?" : "";
  const p = q.len != null ? [q.len] : [];
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM free_names ${w}`).get(...p) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / VOTER_FREE_PAGE));
  const page = Math.min(q.page, pages);
  const names = (sqlite.prepare(`SELECT name FROM free_names ${w} ORDER BY name_len, ord, name LIMIT ? OFFSET ?`).all(...p, VOTER_FREE_PAGE, (page - 1) * VOTER_FREE_PAGE) as Array<{ name: string }>).map((r) => r.name);
  return { names, total, page, pages };
}
