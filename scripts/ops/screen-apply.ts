/**
 * Apply the name-screening result to pool.set_6 (prefiltered), set_7 (rejected) and set_8 (banned).
 * Bundled like migrate.ts into ops/release/screen-apply.cjs and run in a throwaway container of the new image,
 * after migration 19 has added the columns.
 *
 *   node screen-apply.cjs --db /app/data/voting.db --file /tool/screen-categories.tsv.gz [--dry-run]
 *
 * The file is "<name><TAB><6|7|8>" per line (scripts/screen/export-categories.ts). One transaction: every listed
 * name gets exactly its one flag, names in the pool but not in the file get none. Rows that already match are not
 * written, so a replay changes nothing. Only these three columns are touched. Exit 2 when the columns are missing.
 */
import fs from "fs";
import zlib from "zlib";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const out = (o: object, code = 0) => {
  console.log(JSON.stringify(o));
  process.exit(code);
};

const dbPath = opt("db"), file = opt("file");
if (!dbPath || !file || !fs.existsSync(dbPath) || !fs.existsSync(file)) out({ ok: false, error: "need --db and --file that exist" }, 2);

const t0 = Date.now();
const db = new Database(dbPath!);
db.pragma("busy_timeout = 5000");
const cols = (db.prepare("PRAGMA table_info(pool)").all() as Array<{ name: string }>).map((c) => c.name);
if (!["set_6", "set_7", "set_8"].every((c) => cols.includes(c))) out({ ok: false, error: "pool has no set_6..set_8: run migration 19 first" }, 2);

const rows = zlib.gunzipSync(fs.readFileSync(file!)).toString("utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
if (rows.some(([n, s]) => !n || !["6", "7", "8"].includes(s))) out({ ok: false, error: "bad line in category file" }, 2);

const changedFlag = (a: string) => `(set_6 != (${a} = 6) OR set_7 != (${a} = 7) OR set_8 != (${a} = 8))`;
const run = db.transaction(() => {
  db.exec("CREATE TEMP TABLE screen_cat(name TEXT PRIMARY KEY, s INTEGER NOT NULL) WITHOUT ROWID");
  const ins = db.prepare("INSERT INTO screen_cat VALUES (?, ?)");
  for (const [n, s] of rows) ins.run(n, Number(s));
  const matched = (db.prepare("SELECT COUNT(*) AS n FROM screen_cat c JOIN pool p ON p.name = c.name").get() as { n: number }).n;
  const set = db.prepare(
    `UPDATE pool SET set_6 = (c.s = 6), set_7 = (c.s = 7), set_8 = (c.s = 8) FROM screen_cat c WHERE pool.name = c.name AND ${changedFlag("c.s")}`,
  ).run().changes;
  const cleared = db.prepare(
    "UPDATE pool SET set_6 = 0, set_7 = 0, set_8 = 0 WHERE (set_6 OR set_7 OR set_8) AND NOT EXISTS (SELECT 1 FROM screen_cat c WHERE c.name = pool.name)",
  ).run().changes;
  const totals = db.prepare(
    "SELECT SUM(set_6) AS s6, SUM(set_7) AS s7, SUM(set_8) AS s8, SUM(name_len = 5) AS len5, SUM(name_len = 5 AND NOT (set_6 OR set_7 OR set_8)) AS len5_uncategorised FROM pool",
  ).get();
  db.exec("DROP TABLE screen_cat");
  if (dryRun) throw Object.assign(new Error("dry-run"), { report: { matched, set, cleared, totals } });
  return { matched, set, cleared, totals };
});

let report: object;
try {
  report = run();
} catch (e) {
  const r = (e as { report?: object }).report;
  if (!r) throw e;
  report = { ...r, dryRun: true };
}
if (!dryRun) db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
out({ ok: true, file: rows.length, notInPool: rows.length - (report as { matched: number }).matched, ...report, seconds: (Date.now() - t0) / 1000 });
