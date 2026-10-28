import fs from "fs";
import Papa from "papaparse";
import { getSqlite } from "@/db";
import { normalizeRow } from "@/lib/pool-import";
import { bumpData, cachedCountAsync } from "@/lib/data-cache";
import { poolLengthCounts } from "@/lib/pool";
import { inlineReader, reader, type Reader } from "@/lib/ro";

/**
 * Free-to-register .com names (registrable at reg_price_usd). Since migration v14 they are pool rows
 * with avail = 'free' (the legacy free_names table is drained by db/free-move), so the round builders,
 * batches and Explore pick them like any pool name. A for-sale row always wins over a free one.
 */
export type FreeRow = {
  name: string; len: number; sets: string; set4_part: string | null; shape: string | null; ord: number | null;
  cf_checked_at: number | null; reg_price_usd: number | null; reg_registrar: string | null;
};
export type FreeQuery = { len: number | null; set: number | null; q: string; page: number };
export const FREE_PAGE = 60;
export const VOTER_FREE_PAGE = 120;

/** Rows per transaction, and rows per multi-row INSERT statement (14 params each, well under SQLite's 32766). */
const BATCH = 10000;
const CHUNK = 500;
const COLS = ["name", "set_1", "set_2", "set_3", "set_4", "set_5", "set4_part", "shape", "ord", "import_tag", "imported_at", "cf_checked_at", "reg_price_usd", "reg_registrar"] as const;

function num(v: unknown) {
  const s = String(v ?? "").trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}
/**
 * Import-time guard: free_names only ever holds names that can still be registered. A row whose
 * availability column says otherwise (cf_free / available / status) is rejected, never stored.
 */
const NOT_FREE = new Set(["0", "false", "no", "n", "taken", "registered", "unavailable"]);
export function isRegistrable(row: Record<string, unknown>) {
  for (const k of ["cf_free", "available", "status"]) {
    const s = String(row[k] ?? "").trim().toLowerCase();
    if (s && NOT_FREE.has(s)) return false;
  }
  return true;
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


function int(v: unknown) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.trunc(n) : null;
}

/**
 * Streams a candidates CSV into the pool as avail = 'free' (upsert by name). Reuses the pool's
 * name/length/set normalisation. A name already in the pool for sale is left alone (counted as skipped).
 */
export function importFreeCsv(file: string, tag: string | null): Promise<{ read: number; upserted: number; skipped: number; error?: string }> {
  const sqlite = getSqlite();
  const now = Date.now();
  const upsertSql = (n: number) =>
    `INSERT INTO pool (${COLS.join(", ")}, avail) VALUES ${Array(n).fill(`(${COLS.map(() => "?").join(",")},'free')`).join(",")}
    ON CONFLICT(name) DO UPDATE SET set_1 = excluded.set_1, set_2 = excluded.set_2, set_3 = excluded.set_3, set_4 = excluded.set_4, set_5 = excluded.set_5,
      set4_part = excluded.set4_part, shape = excluded.shape, ord = excluded.ord, import_tag = coalesce(pool.import_tag, excluded.import_tag), imported_at = excluded.imported_at,
      cf_checked_at = coalesce(excluded.cf_checked_at, pool.cf_checked_at),
      reg_price_usd = coalesce(excluded.reg_price_usd, pool.reg_price_usd), reg_registrar = coalesce(excluded.reg_registrar, pool.reg_registrar)
    WHERE pool.avail = 'free'`;
  const full = sqlite.prepare(upsertSql(CHUNK));
  const flush = sqlite.transaction((rows: unknown[][]) => {
    let i = 0;
    let changed = 0;
    for (; i + CHUNK <= rows.length; i += CHUNK) changed += full.run(rows.slice(i, i + CHUNK).flat()).changes;
    if (i < rows.length) changed += sqlite.prepare(upsertSql(rows.length - i)).run(rows.slice(i).flat()).changes;
    stats.upserted += changed;
    stats.skipped += rows.length - changed;
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
        const row = isRegistrable(res.data) ? normalizeRow(res.data, now) : null;
        if (!row) {
          stats.skipped += 1;
          return;
        }
        const d = res.data;
        const price = num(d.reg_price_usd);
        buf.push([
          row.name, row.set_1, row.set_2, row.set_3, row.set_4, row.set_5, row.set4_part ?? null, row.shape ?? null, int(d.ord),
          tag ?? row.import_tag ?? null, now, when(d.cf_checked_at),
          price != null && price >= 0 && price < 1e5 ? Math.round(price * 100) / 100 : null,
          String(d.reg_registrar ?? "").trim().toLowerCase().slice(0, 40) || null,
        ]);
        if (buf.length >= BATCH) {
          flush(buf);
          buf = [];
        }
      },
      complete() {
        if (buf.length) flush(buf);
        bumpData();
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
  // Literal (not a parameter) so SQLite can use the partial pool_free_ord_idx.
  const w: string[] = ["f.avail = 'free'"];
  const params: unknown[] = [];
  if (q.len != null) w.push("f.name_len = ?"), params.push(q.len);
  if (q.set != null) w.push(`f.set_${q.set} = 1`);
  if (q.q) w.push("f.name LIKE ?"), params.push(`%${q.q}%`);
  return { sql: `WHERE ${w.join(" AND ")}`, params };
}

const ORDER = ["f.name_len", "f.ord", "f.name"];

/**
 * One page in (name_len, ord, name) order. The covering partial index pool_free_ord_idx (v14) makes OFFSET an
 * index-only walk; pages past the middle walk from the far end instead (exact reverse, NULL ord
 * included), so the last page is as cheap as the first.
 */
function pageRows<T>(r: Reader, select: string, w: { sql: string; params: unknown[] }, total: number, page: number, size: number): Promise<T[]> {
  const offset = (page - 1) * size;
  const ids = (dir: "ASC" | "DESC", limit: number, off: number) =>
    `SELECT f.name FROM pool f ${w.sql} ORDER BY ${ORDER.map((c) => `${c} ${dir}`).join(", ")} LIMIT ${limit} OFFSET ${off}`;
  if (offset <= total / 2) {
    return r.all<T>(`SELECT ${select} FROM pool f WHERE f.name IN (${ids("ASC", size, offset)}) ORDER BY ${ORDER.join(", ")}`, w.params);
  }
  const end = Math.min(total, offset + size);
  const limit = Math.max(0, end - offset);
  return r.all<T>(`SELECT ${select} FROM pool f WHERE f.name IN (${ids("DESC", limit, total - end)}) ORDER BY ${ORDER.join(", ")}`, w.params);
}

async function countFree(w: { sql: string; params: unknown[] }, len: number | null, onlyLen: boolean) {
  if (onlyLen) {
    const counts = await freeLengthCounts();
    return len == null ? counts.reduce((a, c) => a + c.count, 0) : (counts.find((c) => c.length === len)?.count ?? 0);
  }
  return cachedCountAsync("free", w.sql, w.params, async () => (await reader().get<{ n: number }>(`SELECT COUNT(*) AS n FROM pool f ${w.sql}`, w.params))!.n);
}

/** Admin list; set / text filters scan, so they run off the main thread. */
export async function browseFree(q: FreeQuery) {
  const w = where(q);
  const total = await countFree(w, q.len, q.set == null && !q.q);
  const pages = Math.max(1, Math.ceil(total / FREE_PAGE));
  const page = Math.min(q.page, pages);
  const rows = await pageRows<FreeRow>(
    q.set != null || q.q ? reader() : inlineReader(),
    `f.name, f.name_len AS len, f.set4_part, f.shape, f.ord, f.cf_checked_at, f.reg_price_usd, f.reg_registrar,
       rtrim((CASE WHEN f.set_1 = 1 THEN '1,' ELSE '' END) || (CASE WHEN f.set_3 = 1 THEN '3,' ELSE '' END) || (CASE WHEN f.set_4 = 1 THEN '4,' ELSE '' END) || (CASE WHEN f.set_5 = 1 THEN '5,' ELSE '' END), ',') AS sets`,
    w,
    total,
    page,
    FREE_PAGE,
  );
  return { rows, total, page, pages };
}

/** Free names per length (the free share of poolLengthCounts); cached until the pool changes. */
export async function freeLengthCounts() {
  return (await poolLengthCounts()).filter((c) => (c.free ?? 0) > 0).map((c) => ({ length: c.length, count: c.free ?? 0 }));
}


/** Voter tab: name + registration price only (no tags, no sets). */
export type VoterFree = { name: string; regPrice: number | null };
/** Voters stay on the main connection (an index-only page, ~ms) so they never queue behind admin reads. */
export async function browseFreeForVoters(q: Pick<FreeQuery, "len" | "page">) {
  const w = where({ len: q.len, set: null, q: "", page: 1 });
  const total = await countFree(w, q.len, true);
  const pages = Math.max(1, Math.ceil(total / VOTER_FREE_PAGE));
  const page = Math.min(q.page, pages);
  const rows = await pageRows<VoterFree>(inlineReader(), "f.name, f.reg_price_usd AS regPrice", w, total, page, VOTER_FREE_PAGE);
  return { rows, total, page, pages };
}
