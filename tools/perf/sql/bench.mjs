// Research only. Source DB is opened read-only; each run restores a full scratch copy.
// Oracle: count/position conservation and characterized ordered membership from the
// unchanged production selector. This does not establish the product's intended order.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import Database from "better-sqlite3";
import { createJiti } from "jiti";
import { replaySpool } from "./spool-reader.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const args = Object.fromEntries(process.argv.slice(2).map((x) => x.replace(/^--/, "").split("=")));
if (!args.source) throw new Error("Pass --source=<local-replica>");
const source = path.resolve(args.source);
const scratch = path.join(root, "data/perf-sql");
const file = path.join(scratch, "voting.db");
fs.mkdirSync(scratch, { recursive: true });
if (source === file) throw new Error("Source must differ from scratch");
const src = new Database(source, { readonly: true, fileMustExist: true });
const metadata = {
  nodeVersion: process.version, platform: process.platform, arch: process.arch,
  sourceBytes: fs.statSync(source).size,
  userVersion: src.pragma("user_version", { simple: true }),
  sqliteVersion: src.prepare("SELECT sqlite_version() v").get().v,
  counts: Object.fromEntries(["pool", "domains", "rounds", "round_batch_items"].map((t) => [t, src.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])),
};
src.close();
process.env.DATA_DIR = scratch;
process.env.DV_FREE_MOVE = "off";
process.env.DV_RO_WORKERS = "1";
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const batches = jiti(path.join(root, "src/lib/batches.ts"));
const { reader } = jiti(path.join(root, "src/lib/ro.ts"));
const { poolWhere, emptyPoolFilters } = jiti(path.join(root, "src/lib/pool.ts"));
const { copyBatchAssignees, setBatchAssignees } = jiti(path.join(root, "src/lib/assignees.ts"));
const chunkSize = Number(args.chunk || 2000);
if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 2000) throw new Error("chunk must be 1..2000");
const cooperate = () => new Promise((resolve) => setImmediate(resolve));

async function* queryRows(sql, params, phases) {
  if (args.transport !== "spool") {
    yield* reader().chunks(sql, params, chunkSize);
    return;
  }
  const output = path.join(scratch, `spool-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
  const t = performance.now();
  const meta = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(import.meta.dirname, "spool-worker.cjs"), { workerData: { mod: createRequire(import.meta.url).resolve("better-sqlite3"), file, output, sql, params } });
    worker.once("message", (m) => m.ok ? resolve(m) : reject(new Error(m.error)));
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Spool worker exited ${code}`)); });
  });
  phases.spoolMs = (phases.spoolMs || 0) + performance.now() - t;
  phases.maxSpoolBytes = Math.max(phases.maxSpoolBytes || 0, meta.bytes);
  phases.spoolRows = (phases.spoolRows || 0) + meta.rows;
  try {
    yield* replaySpool(output, chunkSize);
  } finally {
    fs.rmSync(output);
  }
}

function reset() {
  if (globalThis.sqlite) globalThis.sqlite.close();
  // Existing read worker retains its handle across restores on Windows, so each
  // benchmark invocation performs exactly one restored run. Parent shell repeats.
  for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix);
  fs.copyFileSync(source, file);
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  globalThis.sqlite = db;
  return db;
}

function selection(input) {
  const w = poolWhere(input.filters);
  const extra = input.excludeUsed ? " AND p.name NOT IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL)" : "";
  const where = w.sql + extra;
  const order = input.order === "name" ? "p.name" : "dv_seeded_rank(?, p.name), p.name";
  const params = [...w.params, ...(input.order === "random" ? [input.seed] : []), input.cap];
  // No window numbering and no ordered string aggregation. The frozen position
  // comes from the cursor offset. Existing read worker holds one cursor/snapshot.
  const direct = `SELECT p.name FROM pool p ${where} ORDER BY ${order} LIMIT ?`;
  const inner = `SELECT p.name,p.price_usd,p.dns_ns_class,p.dns_parking_provider,p.set_1,p.set_2,p.set_3,p.set_4,p.set_5 FROM pool p ${where} ORDER BY ${order} LIMIT ?`;
  const baseline = `SELECT group_concat(name,char(10) ORDER BY rn) s FROM (SELECT p.name name,ROW_NUMBER() OVER (ORDER BY ${order}) rn FROM (${inner}) p)`;
  const baselineParams = [...(input.order === "random" ? [input.seed] : []), ...params];
  return { direct, params, baseline, baselineParams };
}

async function optimized(input, db, phases) {
  const q = selection(input);
  const t = performance.now();
  const id = Number(db.prepare(`INSERT INTO round_batches(title,filter_json,order_mode,seed,block_total,per_round,rounds_planned,remainder_mode,created_at,created_by)
    VALUES(?,?,?,?,0,?,?,?,?,?)`).run(input.title, JSON.stringify({ ...input.filters, cap: input.cap, excludeUsed: input.excludeUsed }), input.order, input.order === "random" ? input.seed : null, input.plan.perRound, input.plan.rounds, input.plan.remainderMode, Date.now(), input.adminId).lastInsertRowid);
  const insert = db.prepare("INSERT INTO round_batch_items(batch_id,position,name) SELECT ?,?+j.key+1,j.value FROM json_each(?) j");
  const write = db.transaction((rows, offset) => insert.run(id, offset, JSON.stringify(rows.map((r) => r.name))).changes);
  let total = 0;
  for await (const rows of queryRows(q.direct, q.params, phases)) {
    if (!rows.length) continue;
    total += write(rows, total);
    if (args.transport === "spool") await cooperate(); else await pause(5);
  }
  phases.snapshotMs = performance.now() - t;
  phases.existingReaderQueueUnbounded = args.transport !== "spool";
  db.prepare("UPDATE round_batches SET block_total=? WHERE id=?").run(total, id);
  setBatchAssignees(id, []);
  const plan = batches.planBatch({ ...input.plan, total });
  const howMany = input.createNow > 0 ? Math.min(input.createNow, plan.sizes.length) : plan.sizes.length;
  const created = [];
  const tm = performance.now();
  let start = 0;
  for (let i = 0; i < howMany; i++) {
    created.push(args.materialize === "chunked" ? await openChunked(id, i, start, plan.sizes[i], input, db, phases) : batches.openBatchRound(id).roundId);
    start += plan.sizes[i];
    if (args.transport === "spool") await cooperate(); else await pause(0);
  }
  phases.materializeMs = performance.now() - tm;
  return { batchId: id, total, created };
}

async function openChunked(batchId, index, start, size, input, db, phases) {
  const now = Date.now();
  const batch = batches.getBatch(batchId);
  const totalRounds = batches.planBatch({ ...input.plan, total: batch.blockTotal }).sizes.length;
  const title = `${input.title} · ${index + 1}/${totalRounds}`;
  const roundId = Number(db.prepare(`INSERT INTO rounds(title,status,parent_round_id,filter_json,sort_mode,created_at,opened_at,source,batch_id,batch_index)
    VALUES(?,'closed',NULL,?,?,?,NULL,'pool',?,?)`).run(title, batch.filterJson, input.order, now, batchId, index + 1).lastInsertRowid);
  const insert = db.prepare(`INSERT INTO domains(round_id,position,name,price,is_premium,source_domain_id,pool_name,currency)
    SELECT ?,json_extract(j.value,'$.position'),json_extract(j.value,'$.name'),json_extract(j.value,'$.price'),0,NULL,json_extract(j.value,'$.name'),json_extract(j.value,'$.currency') FROM json_each(?) j`);
  const write = db.transaction((rows) => insert.run(roundId, JSON.stringify(rows)).changes);
  // One read cursor freezes the round's price values as well as membership while
  // main-thread write transactions commit. Separate range queries would not.
  const sql = `SELECT i.position-? position,p.name,COALESCE(p.lp_price,p.best_price) price,p.lp_currency currency
    FROM round_batch_items i JOIN pool p ON p.name=i.name
    WHERE i.batch_id=? AND i.position>? AND i.position<=? ORDER BY i.position`;
  for await (const rows of queryRows(sql, [start, batchId, start, start + size], phases)) {
    if (!rows.length) continue;
    const t = performance.now();
    write(rows);
    phases.maxMaterializationChunkMs = Math.max(phases.maxMaterializationChunkMs ?? 0, performance.now() - t);
    if (args.transport === "spool") await cooperate(); else await pause(5);
  }
  db.transaction(() => {
    copyBatchAssignees(batchId, roundId);
    db.prepare("UPDATE rounds SET status='open',opened_at=? WHERE id=?").run(Date.now(), roundId);
  })();
  return roundId;
}

const db = reset();
const sqliteSettings = Object.fromEntries(["cache_size", "busy_timeout", "wal_autocheckpoint", "temp_store", "synchronous"].map((p) => [p, db.pragma(p, { simple: true })]));
const length = Number(args.length || 5);
const variant = args.variant || "baseline-all";
const input = {
  title: "Local performance sample", filters: { ...emptyPoolFilters(), length, avail: "any" },
  order: args.order || "random", seed: "perf-2026-10-28", cap: Number(args.cap || 800000), excludeUsed: args.exclude !== "false",
  plan: { perRound: Number(args.perRound || 10000), rounds: 80, remainderMode: "extra" },
  createNow: variant.endsWith("all") ? 0 : 1, adminId: 0, assignees: [],
};
batches.ensureFunctions();
const q = selection(input);
const eligibility = poolWhere(input.filters);
const eligibleBeforeBuild = db.prepare(`SELECT COUNT(*) n FROM pool p ${eligibility.sql}${input.excludeUsed ? " AND p.name NOT IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL)" : ""}`).get(...eligibility.params).n;
const expectedSnapshotRows = Math.min(input.cap, eligibleBeforeBuild);
const explain = (sql, params) => db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params).map((r) => r.detail);
const plans = { baseline: explain(q.baseline, q.baselineParams), direct: explain(q.direct, q.params) };
let http = null;
if (args.http === "true") {
  db.exec("CREATE TABLE IF NOT EXISTS perf_writer_probe(id INTEGER PRIMARY KEY,n INTEGER NOT NULL); INSERT OR IGNORE INTO perf_writer_probe VALUES(1,0)");
  const user = db.prepare("SELECT id FROM users LIMIT 1").get();
  const domain = db.prepare("SELECT d.id,d.round_id FROM domains d JOIN rounds r ON r.id=d.round_id WHERE r.status='open' AND NOT EXISTS(SELECT 1 FROM votes v WHERE v.domain_id=d.id AND v.user_id=?) LIMIT 1").get(user.id);
  const voteCountBefore = db.prepare("SELECT COUNT(*) n FROM votes").get().n;
  const vote = db.transaction(() => {
    db.prepare("INSERT INTO votes(round_id,domain_id,user_id,created_at) VALUES(?,?,?,?) ON CONFLICT(domain_id,user_id) DO NOTHING").run(domain.round_id, domain.id, user.id, Date.now());
    db.prepare("SELECT COUNT(*) n FROM votes WHERE round_id=? AND user_id=?").get(domain.round_id, user.id);
    db.prepare("DELETE FROM votes WHERE domain_id=? AND user_id=?").run(domain.id, user.id);
  });
  let writeFailures = 0;
  const server = createServer((req, res) => {
    try { if (req.url === "/write") vote(); else db.prepare("SELECT 1 n").get(); }
    catch { writeFailures++; res.statusCode = 503; }
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  const probe = new Worker(new URL("./http-probe.mjs", import.meta.url), { workerData: { port: server.address().port } });
  const window = { start: Infinity, end: Infinity };
  const pings = [], writes = [], errors = [], statusCounts = {};
  const writerLatencies = [], writerErrors = [];
  let writerTimer;
  probe.on("message", (m) => {
    if (m.started >= window.start && m.started <= window.end) {
      (m.kind === "write" ? writes : pings).push(m.ms);
      const key = `${m.kind}:${m.status ?? "error"}`;
      statusCounts[key] = (statusCounts[key] || 0) + 1;
      if (m.error || m.status !== 200) errors.push({ kind: m.kind, status: m.status, error: m.error, ms: m.ms });
    }
  });
  const stats = (values) => { const sorted = values.toSorted((a, b) => a - b); return { n: sorted.length, p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null, maxMs: sorted.at(-1) ?? null }; };
  http = {
    window,
    startWriter() {
      writerTimer = setInterval(() => {
        const t = performance.now();
        try { db.prepare("UPDATE perf_writer_probe SET n=n+1 WHERE id=1").run(); writerLatencies.push(performance.now() - t); }
        catch (error) { writerErrors.push(error.code); }
      }, 25);
    },
    stopWriter() { clearInterval(writerTimer); },
    async stop() {
      const drain = await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("HTTP probe drain deadline")), 15000);
        probe.on("message", (m) => { if (m.drained) { clearTimeout(deadline); resolve({ startedCount: m.startedCount, completedCount: m.completedCount }); } });
        probe.postMessage({ stop: true });
      });
      await probe.terminate();
      await new Promise((resolve) => server.close(resolve));
      return { ping: stats(pings), voteShapedWrite: stats(writes), writerProbe: stats(writerLatencies), writerErrors, errors, statusCounts, drain, writeFailures, voteCountPreserved: db.prepare("SELECT COUNT(*) n FROM votes").get().n === voteCountBefore };
    },
  };
  await pause(200);
}
// Prime worker startup outside measured interval, without scanning the replica.
await reader().get("SELECT 1 n");
const gaps = [];
let last = performance.now();
let peakRss = process.memoryUsage().rss;
let peakWalBytes = 0;
const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; peakRss = Math.max(peakRss, process.memoryUsage().rss); try { peakWalBytes = Math.max(peakWalBytes, fs.statSync(file + "-wal").size); } catch {} }, 10);
await pause(20);
gaps.length = 0;
last = performance.now();
const beforePages = db.pragma("page_count", { simple: true });
const cpu = process.cpuUsage();
const phases = {};
const started = performance.now();
if (http) { http.window.start = started; http.startWriter(); }
const result = variant.startsWith("sql") ? await optimized(input, db, phases) : await batches.createBatch(input);
const wallMs = performance.now() - started;
if (http) { http.window.end = started + wallMs; http.stopWriter(); }
const cpuUsed = process.cpuUsage(cpu);
await pause(20);
clearInterval(timer);
const httpResults = http ? await http.stop() : null;
peakRss = Math.max(peakRss, process.memoryUsage().rss);
const sortedGaps = gaps.toSorted((a, b) => a - b);
const quantile = (p) => sortedGaps[Math.min(sortedGaps.length - 1, Math.floor(sortedGaps.length * p))] ?? null;
const hash = createHash("sha256");
let count = 0;
let positionsContinuous = true;
for (const row of db.prepare("SELECT position,name FROM round_batch_items WHERE batch_id=? ORDER BY position").iterate(result.batchId)) {
  count++;
  positionsContinuous &&= row.position === count;
  hash.update(row.name + "\n");
}
const generatedDomains = db.prepare("SELECT COUNT(*) n FROM domains WHERE round_id IN (SELECT id FROM rounds WHERE batch_id=?)").get(result.batchId).n;
const mismatch = db.prepare(`SELECT COUNT(*) n FROM domains d JOIN rounds r ON r.id=d.round_id JOIN round_batch_items i ON i.batch_id=r.batch_id AND i.position=(r.batch_index-1)*?+d.position JOIN pool p ON p.name=i.name
  WHERE r.batch_id=? AND (d.name<>i.name OR d.price IS NOT COALESCE(p.lp_price,p.best_price) OR d.currency IS NOT p.lp_currency OR d.pool_name<>p.name)`).get(input.plan.perRound, result.batchId).n;
const expectedDomains = input.createNow === 1 ? Math.min(count, input.plan.perRound) : count;
const assertions = { positionsContinuous, countMatchesResult: count === result.total, independentSnapshotCountCorrect: count === expectedSnapshotRows, materializedCountCorrect: generatedDomains === expectedDomains, priceNameCurrencyMismatches: mismatch };
const output = {
  measuredAt: new Date().toISOString(), metadata, sqliteSettings, variant, input: { filters: input.filters, length, order: input.order, cap: input.cap, excludeUsed: input.excludeUsed, seed: input.seed, perRound: input.plan.perRound, rounds: input.plan.rounds, remainderMode: input.plan.remainderMode, createNow: input.createNow, materialize: args.materialize || "synchronous", transport: args.transport || "queue", chunkSize, yield: args.transport === "spool" ? "setImmediate" : "timers" },
  wallMs, phases, cpuMs: { user: cpuUsed.user / 1000, system: cpuUsed.system / 1000 }, peakRssBytes: peakRss, processHighWaterRssBytes: process.resourceUsage().maxRSS * 1024, http: httpResults,
  timerGapMs: { sampleCount: gaps.length, p95: quantile(.95), max: sortedGaps.at(-1) },
  pagesAdded: db.pragma("page_count", { simple: true }) - beforePages, walBytes: fs.existsSync(file + "-wal") ? fs.statSync(file + "-wal").size : 0, peakWalBytes,
  eligibleBeforeBuild, expectedSnapshotRows, snapshotRows: count, materializedRows: generatedDomains, insertedItemRows: count + generatedDomains, roundRows: result.created.length,
  membershipSha256: hash.digest("hex"), assertions, plans,
};
if (args.out) fs.writeFileSync(args.out, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
const correct = positionsContinuous && count === result.total && count === expectedSnapshotRows && generatedDomains === expectedDomains && mismatch === 0;
const responsive = quantile(.95) < 250 && sortedGaps.at(-1) < 1000;
db.close();
// Worker cursor has completed and readonly workers are unref'd by production code.
const httpCorrect = !httpResults || (httpResults.ping.n > 0 && httpResults.voteShapedWrite.n > 0 && httpResults.writerErrors.length === 0 && httpResults.errors.length === 0 && httpResults.writeFailures === 0 && httpResults.voteCountPreserved && httpResults.drain.startedCount === httpResults.drain.completedCount);
const httpResponsive = !httpResults || (httpResults.ping.p95Ms < 250 && httpResults.ping.maxMs < 1000 && httpResults.voteShapedWrite.p95Ms < 250 && httpResults.voteShapedWrite.maxMs < 1000);
if (!correct || !httpCorrect || (args.gate === "true" && (!responsive || !httpResponsive))) process.exitCode = 1;
