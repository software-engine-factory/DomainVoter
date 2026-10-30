/**
 * Release migration (ops CLI). Bundled with esbuild into one .cjs and run in a throwaway container of the NEW image,
 * as the app user, while the app is stopped. `apply` goes through the app's own getSqlite(), so the base schema and
 * migration list are exactly the ones the release serves with; the app's lazy migration on first request is then a no-op.
 *
 *   node migrate.cjs check --db /app/data/voting.db                  read-only; exit 3 if anything is pending
 *   node migrate.cjs apply --db /app/data/voting.db [--quick-check]  apply pending, truncate the WAL, check again
 *
 * `apply` hashes the user-data tables over their pre-migration columns before and after, and fails (exit 3) unless
 * every hash and row count is unchanged. Added columns (e.g. rounds.creation_job_id) do not count as a change.
 *
 * Refuses (exit 2) a missing database, an empty users table, or applied versions this release does not know
 * (a migration from another branch): those need reconciliation, not a forced apply.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getSqlite } from "@/db";
import { LATEST_SCHEMA_VERSION, MIGRATION_VERSIONS } from "@/db/migrations";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i > 0 ? args[i + 1] : undefined;
};
const has = (k: string) => args.includes(`--${k}`);

function die(msg: string): never {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(2);
}

function inspect(db: Database.Database) {
  const hasTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  const applied = hasTable ? (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version) : [];
  return {
    userVersion: db.pragma("user_version", { simple: true }) as number,
    latest: LATEST_SCHEMA_VERSION,
    applied,
    pending: MIGRATION_VERSIONS.filter((v) => !applied.includes(v)),
    unknown: applied.filter((v) => !MIGRATION_VERSIONS.includes(v)),
    users: (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n,
  };
}

const PRESERVED = ["users", "rounds", "domains", "votes", "views", "round_batches", "round_batch_items", "round_supplements", "picks"];

/** Column lists of the preserved tables as they are now; the same lists are hashed again after migrating. */
function shape(db: Database.Database) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
  return Object.fromEntries(
    PRESERVED.filter((t) => tables.includes(t)).map((t) => [t, (db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string; pk: number }>)]),
  );
}

function fingerprint(db: Database.Database, cols: ReturnType<typeof shape>) {
  const out: Record<string, { rows: number; sha256: string }> = {};
  for (const [t, info] of Object.entries(cols)) {
    const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => `"${c.name}"`);
    const h = crypto.createHash("sha256");
    let rows = 0;
    for (const row of db.prepare(`SELECT ${info.map((c) => `"${c.name}"`).join(", ")} FROM "${t}" ORDER BY ${pk.length ? pk.join(", ") : "rowid"}`).raw().iterate()) {
      h.update(JSON.stringify(row));
      h.update("\n");
      rows += 1;
    }
    out[t] = { rows, sha256: h.digest("hex") };
  }
  out.pool = { rows: (db.prepare("SELECT COUNT(*) AS n FROM pool").get() as { n: number }).n, sha256: "" };
  return out;
}

const file = path.resolve(opt("db") ?? die("--db required"));
if (path.basename(file) !== "voting.db") die("--db must point at voting.db (the app opens DATA_DIR/voting.db)");
if (!fs.existsSync(file)) die(`no database at ${file}`);

const ro = new Database(file, { readonly: true, fileMustExist: true });
const before = inspect(ro);
if (before.unknown.length) die(`applied migrations unknown to this release: ${before.unknown.join(",")}`);
if (before.users === 0) die("users table is empty; refusing to treat this as the production database");
const cols = shape(ro);
const t00 = Date.now();
const dataBefore = cmd === "apply" ? fingerprint(ro, cols) : null;
const fingerprintMs = Date.now() - t00;
ro.close();

if (cmd === "check") {
  console.log(JSON.stringify({ ok: before.pending.length === 0, ...before }, null, 1));
  if (before.pending.length) process.exit(3);
} else if (cmd === "apply") {
  process.env.DATA_DIR = path.dirname(file);
  process.env.DV_FREE_MOVE = "off"; // the legacy free-name mover is resumed separately, never during a release
  const t0 = Date.now();
  const sqlite = getSqlite();
  const migrateMs = Date.now() - t0;
  const t1 = Date.now();
  const checkpoint = sqlite.pragma("wal_checkpoint(TRUNCATE)");
  const checkpointMs = Date.now() - t1;
  let quickCheck: unknown = "skipped";
  const t2 = Date.now();
  if (has("quick-check")) quickCheck = sqlite.pragma("quick_check", { simple: true });
  const quickCheckMs = Date.now() - t2;
  const after = inspect(sqlite);
  const dataAfter = fingerprint(sqlite, cols);
  sqlite.close();
  const changed = Object.keys(dataBefore!).filter((t) => JSON.stringify(dataBefore![t]) !== JSON.stringify(dataAfter[t]));
  const ok = after.pending.length === 0 && changed.length === 0 && (quickCheck === "skipped" || quickCheck === "ok");
  console.log(JSON.stringify({ ok, before: before.applied, appliedNow: before.pending, after, preserved: changed.length === 0, changed,
    data: dataAfter, fingerprintMs, migrateMs, checkpoint, checkpointMs, quickCheck, quickCheckMs }, null, 1));
  if (!ok) process.exit(3);
} else die("usage: check|apply --db voting.db [--quick-check]");
