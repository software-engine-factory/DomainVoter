/**
 * Offline for-sale importer (ops CLI). Bundled with esbuild into one .cjs and run inside the app image as the app user.
 * Reuses the app's own row rules: normalizeRow (pool-import.ts) and isRegistrable (free-names.ts).
 * Differences from the admin upload: duplicates are SKIPPED (ON CONFLICT DO NOTHING), so existing pool / free_names
 * rows and every round's frozen `domains` copy are never rewritten, and undo-by-tag removes exactly what one run added.
 *
 *   node import-forsale.cjs validate --dir D --tag T
 *   node import-forsale.cjs import   --db voting.db --dir D --tag T [--dry-run]
 *   node import-forsale.cjs undo     --db voting.db --tag T
 *   node import-forsale.cjs stats    --db voting.db [--integrity]
 *   node import-forsale.cjs backup   --db voting.db --out copy.db
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { normalizeRow } from "@/lib/pool-import";
import { isRegistrable } from "@/lib/free-names";

type Raw = Record<string, unknown>;
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i > 0 ? args[i + 1] : undefined;
};
const has = (k: string) => args.includes(`--${k}`);
const BATCH = 5000; // rows per write transaction: short enough that live votes never wait on the import
const MIN_SCHEMA = 12;

function die(msg: string): never {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(2);
}
const sha256File = (f: string) => {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(f, "r");
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest("hex");
};

type Kind = "purchasable" | "registrable";
type Part = { kind: Kind; db: string; manifest: Raw; table: string; columns: string[] };

/** Finds and checks both exports of a tag. A missing registrable/purchasable file is allowed only if its manifest is absent too. */
function loadParts(dir: string, tag: string) {
  const files: Record<Kind, string> = { purchasable: `app_export_${tag}`, registrable: `registrable_${tag}` };
  const parts: Part[] = [];
  const checks: Raw[] = [];
  for (const kind of ["purchasable", "registrable"] as Kind[]) {
    const base = path.join(dir, files[kind]);
    if (!fs.existsSync(base + ".manifest.json")) {
      checks.push({ kind, present: false });
      continue;
    }
    const m = JSON.parse(fs.readFileSync(base + ".manifest.json", "utf8")) as Raw;
    const errs: string[] = [];
    if (m.tag !== tag) errs.push(`manifest tag ${m.tag} != ${tag}`);
    if (m.kind !== kind) errs.push(`manifest kind ${m.kind} != ${kind}`);
    if (m.integrity !== "ok") errs.push(`manifest integrity ${m.integrity}`);
    if (!fs.existsSync(base + ".db")) errs.push("db file missing");
    const sha = (m.sha256 as Raw | undefined)?.db;
    const actual = fs.existsSync(base + ".db") ? sha256File(base + ".db") : null;
    if (!sha || sha !== actual) errs.push(`db sha256 mismatch (manifest ${String(sha).slice(0, 12)}…, file ${String(actual).slice(0, 12)}…)`);
    let rows = -1, tagRows = -1, lenBad = -1, cols: string[] = [];
    const table = String(m.table ?? "");
    if (actual) {
      const src = new Database(base + ".db", { readonly: true, fileMustExist: true });
      const ic = src.pragma("integrity_check", { simple: true });
      if (ic !== "ok") errs.push(`file integrity_check ${ic}`);
      const t = src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!t) errs.push(`table ${table} missing`);
      else {
        cols = (src.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
        const want = (m.columns as string[]) ?? [];
        if (cols.join(",") !== want.join(",")) errs.push(`columns differ from manifest: file=[${cols}] manifest=[${want}]`);
        rows = (src.prepare(`SELECT count(*) n FROM "${table}"`).get() as { n: number }).n;
        if (rows !== m.rows || rows !== m.db_rows) errs.push(`row count ${rows} != manifest rows ${m.rows}/db_rows ${m.db_rows}`);
        tagRows = cols.includes("import_tag") ? (src.prepare(`SELECT count(*) n FROM "${table}" WHERE import_tag IS NOT ?`).get(tag) as { n: number }).n : rows;
        if (tagRows) errs.push(`${tagRows} rows carry another import_tag`);
        if (m.length != null && cols.includes("length")) {
          lenBad = (src.prepare(`SELECT count(*) n FROM "${table}" WHERE CAST(length AS INTEGER) IS NOT ?`).get(m.length) as { n: number }).n;
          if (lenBad) errs.push(`${lenBad} rows with length != ${m.length}`);
        }
      }
      src.close();
    }
    checks.push({ kind, present: true, rows, manifestRows: m.rows, sha256ok: !!sha && sha === actual, columnsOk: !errs.some((e) => e.startsWith("columns")), errors: errs });
    if (errs.length) continue;
    parts.push({ kind, db: base + ".db", manifest: m, table, columns: cols });
  }
  const failed = checks.some((c) => c.present && (c.errors as string[]).length);
  return { parts, checks, failed };
}

/** Applies the app's own row rules plus the import-time "only purchasable / only registrable" guard. */
function classify(kind: Kind, raw: Raw, now: number, tag: string) {
  const row = normalizeRow(raw, now);
  if (!row) return { reject: "invalid" as const };
  if (row.import_tag !== tag) return { reject: "tag" as const };
  if (kind === "purchasable") {
    // A pool row must carry for-sale evidence; anything else is not purchasable and never enters the DB.
    if (row.evidence !== "sale_page" && row.evidence !== "nameserver") return { reject: "not_purchasable" as const };
    return { pool: row };
  }
  // free_names: only names the export marks free (cf_free=1). There is no 'taken' state in v12.
  const cf = String(raw.cf_free ?? "").trim();
  if (!isRegistrable(raw) || ("cf_free" in raw && cf !== "1")) return { reject: "not_free" as const };
  const price = raw.reg_price_usd == null || raw.reg_price_usd === "" ? null : Number(raw.reg_price_usd);
  const ts = String(raw.cf_checked_at ?? "").trim();
  const when = ts ? (Number.isFinite(Number(ts)) ? (Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts)) : Date.parse(ts)) : null;
  return {
    free: [
      row.name, row.set_1, row.set_2, row.set_3, row.set_4, row.set_5, row.set4_part, row.shape,
      Number(raw.__rid), tag, now, Number.isFinite(when as number) ? when : null,
      price != null && Number.isFinite(price) && price >= 0 && price < 1e5 ? Math.round(price * 100) / 100 : null,
      String(raw.reg_registrar ?? "").trim().toLowerCase().slice(0, 40) || null,
    ],
  };
}

function openTarget(file: string) {
  if (!fs.existsSync(file)) die(`db not found: ${file}`);
  const db = new Database(file, { fileMustExist: true });
  db.pragma("busy_timeout = 15000");
  const v = db.pragma("user_version", { simple: true }) as number;
  const freeCols = (db.prepare("PRAGMA table_info(free_names)").all() as Array<{ name: string }>).map((c) => c.name);
  if (v < MIN_SCHEMA || !freeCols.includes("reg_price_usd") || freeCols.includes("cf_free"))
    die(`target schema not v${MIN_SCHEMA}+ as expected (user_version=${v})`);
  return db;
}

function hashQuery(db: Database.Database, sql: string) {
  const h = crypto.createHash("sha256");
  let n = 0;
  for (const r of db.prepare(sql).raw().iterate()) h.update(JSON.stringify(r)), n++;
  return { rows: n, sha256: h.digest("hex") };
}
const one = (db: Database.Database, sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
function stats(db: Database.Database, integrity = false) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
  const frozen = ["rounds", "domains", "round_supplements", "round_batches", "round_batch_items", "votes", "users"].filter((t) => tables.includes(t));
  const pk = (t: string) => (t === "round_batch_items" ? "batch_id, position" : "rowid");
  return {
    user_version: db.pragma("user_version", { simple: true }),
    bytes: (db.pragma("page_count", { simple: true }) as number) * (db.pragma("page_size", { simple: true }) as number),
    counts: Object.fromEntries(["pool", "free_names", "rounds", "domains", "votes", "views", "users", "round_supplements"].filter((t) => tables.includes(t)).map((t) => [t, one(db, `SELECT count(*) n FROM "${t}"`)])),
    poolByTag: db.prepare("SELECT coalesce(import_tag,'(none)') tag, count(*) n FROM pool GROUP BY 1 ORDER BY 1").all(),
    freeByTag: db.prepare("SELECT coalesce(import_tag,'(none)') tag, count(*) n FROM free_names GROUP BY 1 ORDER BY 1").all(),
    hashes: Object.fromEntries(frozen.map((t) => [t, hashQuery(db, `SELECT * FROM "${t}" ORDER BY ${pk(t)}`)])),
    ...(integrity ? { integrity: db.pragma("integrity_check", { simple: true }) } : {}),
  };
}

function runImport(db: Database.Database, parts: Part[], tag: string, dry: boolean) {
  const now = Date.now();
  const insPool = db.prepare(`INSERT INTO pool (name, set_1, set_2, set_3, set_4, set_5, evidence, dns_ns_class, dns_parking_provider,
      lp_marketplace, lp_price, lp_currency, lp_url, best_price, best_source, price_usd, imported_at, shape, set4_part, import_tag, best_currency)
    VALUES (@name, @set_1, @set_2, @set_3, @set_4, @set_5, @evidence, @dns_ns_class, @dns_parking_provider,
      @lp_marketplace, @lp_price, @lp_currency, @lp_url, @best_price, @best_source, @price_usd, @imported_at, @shape, @set4_part, @import_tag, @best_currency)
    ON CONFLICT(name) DO NOTHING`);
  const insFree = db.prepare(`INSERT INTO free_names (name, set_1, set_2, set_3, set_4, set_5, set4_part, shape, ord, import_tag, imported_at,
      cf_checked_at, reg_price_usd, reg_registrar) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING`);
  const inPool = db.prepare("SELECT 1 FROM pool WHERE name = ?").pluck();
  const inFree = db.prepare("SELECT 1 FROM free_names WHERE name = ?").pluck();
  const out: Raw = {};
  const dryPool = new Set<string>(); // dry run: names the purchasable part would add, so the free part's in_pool check matches a real run
  for (const p of parts) {
    const t0 = Date.now();
    const st = { read: 0, added: 0, dup: 0, rejected: { invalid: 0, tag: 0, not_purchasable: 0, not_free: 0, in_pool: 0 }, alsoInFree: 0, nullPrice: 0 };
    const src = new Database(p.db, { readonly: true, fileMustExist: true });
    const page = src.prepare(`SELECT rowid AS __rid, * FROM "${p.table}" WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH}`);
    const write = db.transaction((rows: Raw[]) => {
      for (const raw of rows) {
        const c = classify(p.kind, raw, now, tag);
        if ("reject" in c && c.reject) { st.rejected[c.reject]++; continue; }
        if (c.pool) {
          if (inFree.get(c.pool.name)) st.alsoInFree++;
          if (dry) { if (inPool.get(c.pool.name)) st.dup++; else st.added++, dryPool.add(c.pool.name); continue; }
          insPool.run(c.pool) .changes ? st.added++ : st.dup++;
        } else if (c.free) {
          if (inPool.get(c.free[0]) || dryPool.has(c.free[0] as string)) { st.rejected.in_pool++; continue; } // for sale elsewhere: never also "free"
          if (c.free[12] == null) st.nullPrice++;
          if (dry) { inFree.get(c.free[0]) ? st.dup++ : st.added++; continue; }
          insFree.run(...c.free).changes ? st.added++ : st.dup++;
        }
      }
    });
    let last = 0;
    for (;;) {
      const rows = page.all(last) as Raw[];
      if (!rows.length) break;
      st.read += rows.length;
      write(rows);
      last = Number(rows[rows.length - 1].__rid);
    }
    src.close();
    out[p.kind] = { ...st, table: p.kind === "purchasable" ? "pool" : "free_names", ms: Date.now() - t0 };
  }
  if (!dry) db.prepare("INSERT INTO imports (source, started_at, finished_at, rows_read, rows_upserted, rows_skipped, error) VALUES (?,?,?,?,?,?,NULL)")
    .run(`ops:import-forsale ${tag}`, now, Date.now(),
      Object.values(out).reduce((a: number, s) => a + ((s as Raw).read as number), 0),
      Object.values(out).reduce((a: number, s) => a + ((s as Raw).added as number), 0),
      Object.values(out).reduce((a: number, s) => a + ((s as Raw).read as number) - ((s as Raw).added as number), 0));
  return out;
}

function runUndo(db: Database.Database, tag: string) {
  const t0 = Date.now();
  const protectedRows = one(db, "SELECT count(*) n FROM pool WHERE import_tag = ? AND name IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL)", tag);
  const del = (sql: string) => {
    let total = 0;
    const stmt = db.prepare(sql);
    for (;;) { const c = stmt.run(tag).changes; total += c; if (c < BATCH) break; }
    return total;
  };
  // pool is WITHOUT ROWID: delete by name; names a round froze (domains.pool_name) are kept.
  const pool = del(`DELETE FROM pool WHERE name IN (SELECT name FROM pool WHERE import_tag = ? AND name NOT IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL) LIMIT ${BATCH})`);
  const free = del(`DELETE FROM free_names WHERE rowid IN (SELECT rowid FROM free_names WHERE import_tag = ? LIMIT ${BATCH})`);
  // A finished imports row bumps the dataset version, so the app's cached facets/counts refresh after an undo too.
  db.prepare("INSERT INTO imports (source, started_at, finished_at, rows_read, rows_upserted, rows_skipped, error) VALUES (?,?,?,0,0,?,NULL)")
    .run(`ops:undo ${tag}`, t0, Date.now(), pool + free);
  return { tag, poolDeleted: pool, freeDeleted: free, poolKeptBecauseInARound: protectedRows, ms: Date.now() - t0 };
}

const tag = opt("tag");
if (cmd === "validate" || cmd === "import") {
  if (!tag || !/^[0-9A-Za-z][0-9A-Za-z._-]{2,40}$/.test(tag)) die("--tag required");
  const dir = opt("dir") ?? die("--dir required");
  const v = loadParts(dir, tag);
  if (v.failed || !v.parts.length) die(JSON.stringify({ validation: v.checks }));
  if (cmd === "validate") {
    // File-level checks only; per-row accept/reject counts come from `import --dry-run` on a copy.
    console.log(JSON.stringify({ ok: true, tag, validation: v.checks }, null, 1));
  } else {
    const db = openTarget(opt("db") ?? die("--db required"));
    const before = stats(db);
    const t0 = Date.now();
    const result = runImport(db, v.parts, tag, has("dry-run"));
    const after = stats(db);
    const frozenSame = Object.keys(before.hashes).filter((k) => k !== "votes" && k !== "users").every((k) => before.hashes[k].sha256 === after.hashes[k].sha256);
    console.log(JSON.stringify({ ok: frozenSame, tag, dryRun: has("dry-run"), validation: v.checks, result, ms: Date.now() - t0,
      bytesBefore: before.bytes, bytesAfter: after.bytes, roundsAndDomainsIdentical: frozenSame }, null, 1));
    db.close();
    if (!frozenSame) process.exit(3);
  }
} else if (cmd === "undo") {
  if (!tag) die("--tag required");
  const db = openTarget(opt("db") ?? die("--db required"));
  console.log(JSON.stringify({ ok: true, ...runUndo(db, tag) }, null, 1));
  db.close();
} else if (cmd === "stats") {
  const db = new Database(opt("db") ?? die("--db required"), { readonly: true, fileMustExist: true });
  console.log(JSON.stringify(stats(db, has("integrity")), null, 1));
} else if (cmd === "backup") {
  const db = new Database(opt("db") ?? die("--db required"), { readonly: true, fileMustExist: true });
  const out = opt("out") ?? die("--out required");
  db.backup(out).then(() => {
    db.close();
    const c = new Database(out, { readonly: true });
    console.log(JSON.stringify({ ok: true, out, integrity: c.pragma("integrity_check", { simple: true }), user_version: c.pragma("user_version", { simple: true }) }));
  }).catch((e) => die(String(e)));
} else die("usage: validate|import|undo|stats|backup");
