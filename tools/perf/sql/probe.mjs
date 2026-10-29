// Optional follow-up, not run in this study. Run only after bench processes
// finish. Mutates only their disposable copy.
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const root = path.resolve(import.meta.dirname, "../../..");
const file = path.join(root, "data/perf-sql/voting.db");
const source = process.argv.find((x) => x.startsWith("--source="))?.slice(9);
if (!source || path.resolve(source) === file) throw new Error("Pass distinct --source=<offline-replica>");
for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix);
fs.copyFileSync(source, file);
const db = new Database(file, { fileMustExist: true });
db.pragma("busy_timeout = 5000");
const where = "p.name_len=5 AND p.name NOT IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL)";
const params = [];
const explain = (sql) => db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params).map((r) => r.detail);
const countFull = `SELECT COUNT(*) n FROM pool p WHERE ${where}`;
const countCapped = `SELECT COUNT(*) n FROM (SELECT 1 FROM pool p WHERE ${where} LIMIT 800000)`;
function timeCount(sql) {
  return Array.from({ length: 3 }, () => { const t = performance.now(); const n = db.prepare(sql).get(...params).n; return { ms: performance.now() - t, n }; });
}
function timeNames(hint = "", lengthCol = "p.name_len") {
  const sql = `SELECT p.name FROM pool p ${hint} WHERE ${where.replace("p.name_len", lengthCol)} ORDER BY p.name LIMIT 800000`;
  const plan = explain(sql);
  const times = [];
  for (let run = 0; run < 3; run++) {
    const t = performance.now(); const hash = createHash("sha256"); let n = 0;
    for (const r of db.prepare(sql).iterate(...params)) { n++; hash.update(r.name + "\n"); }
    times.push({ ms: performance.now() - t, n, membershipSha256: hash.digest("hex") });
  }
  return { plan, times };
}
const output = { measuredAt: new Date().toISOString(), countFull: { plan: explain(countFull), times: timeCount(countFull) }, countCapped: { plan: explain(countCapped), times: timeCount(countCapped) }, nameExisting: timeNames(), namePrimaryWalk: timeNames("", "+p.name_len") };
const pages = db.pragma("page_count", { simple: true });
const freePages = db.pragma("freelist_count", { simple: true });
const t = performance.now();
db.exec("CREATE INDEX IF NOT EXISTS pool_len_name_perf_idx ON pool(name_len,name)");
output.indexBuildMs = performance.now() - t;
output.indexPagesAdded = db.pragma("page_count", { simple: true }) - pages;
output.indexLivePagesAdded = output.indexPagesAdded + freePages - db.pragma("freelist_count", { simple: true });
output.pageSize = db.pragma("page_size", { simple: true });
output.nameWithIndex = timeNames("INDEXED BY pool_len_name_perf_idx");
db.close();
fs.writeFileSync(path.join(import.meta.dirname, "results/sql-probes.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
