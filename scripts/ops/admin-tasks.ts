/**
 * Admin tasks on a live database (ops CLI). Bundled with esbuild into one .cjs, like migrate.ts:
 *
 *   npx -y esbuild@0.28.1 scripts/ops/admin-tasks.ts --bundle --platform=node --format=cjs --alias:@=./src \
 *     --external:better-sqlite3 --external:bcryptjs --outfile=ops/release/admin-tasks.cjs
 *
 * and run in a throwaway container of the release image (WORKDIR /app, so the creation worker at
 * /app/src/lib/creation-worker.cjs is found) while the app keeps running:
 *
 *   node admin-tasks.cjs users          --db /app/data/voting.db
 *   node admin-tasks.cjs display-names  --db /app/data/voting.db --set user6=mokhtari --set "user7=Bohrani B" [--dry-run]
 *   node admin-tasks.cjs create-rounds  --db /app/data/voting.db --sets 6 --length 5 --size 30000 --order random \
 *        --title "5 حرفی" --assign user6 --owner admin [--seed 123456] [--key ops-…] [--dry-run]
 *
 * Output is one JSON document on stdout (progress goes to stderr). Exit codes: 0 ok, 2 refused / bad input,
 * 3 the creation job failed or was cancelled, 4 another creation job is active.
 *
 * Every command refuses a database with pending migrations: this tool never migrates.
 *
 * create-rounds submits the same ticket the admin "multi-round" form (/admin/rounds/batch) posts to /api/creation-jobs:
 * the form fields go through lib/creation-input and lib/creation-jobs.acceptCreationJob (same validation, compact
 * storage v2, one-active-job admission), and the job runs in the app's own worker thread, hosted by this process.
 * The request key is derived from the arguments, so re-running the same command reports the earlier job instead of
 * creating the rounds twice.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { Worker } from "worker_threads";
import { getSqlite } from "@/db";
import { MIGRATION_VERSIONS } from "@/db/migrations";
import { blockWhere, BATCH_ORDERS } from "@/lib/batches";
import { planBatch } from "@/lib/batch-plan";
import { creationInput } from "@/lib/creation-input";
import { acceptCreationJob, changeCreationJob, type CreationJob } from "@/lib/creation-jobs";
import { normalizePoolFilters } from "@/lib/pool";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i > 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const all = (k: string) => args.flatMap((a, i) => (a === `--${k}` && i + 1 < args.length ? [args[i + 1]] : []));
const dryRun = args.includes("--dry-run");

function out(doc: unknown) {
  console.log(JSON.stringify(doc, null, 1));
}
function fail(code: number, error: string, extra: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ ok: false, error, ...extra }, null, 1));
  process.exit(code);
}
const progress = (msg: Record<string, unknown>) => console.error(JSON.stringify({ at: new Date().toISOString(), ...msg }));

const USAGE = "usage: users | display-names --set user=name ... | create-rounds --sets N --length N --size N --order random --title T --assign USER --owner ADMIN  (all: --db voting.db [--dry-run])";
if (!["users", "display-names", "create-rounds"].includes(cmd)) fail(2, USAGE);

const file = path.resolve(opt("db") ?? fail(2, "--db required"));
if (path.basename(file) !== "voting.db") fail(2, "--db must point at voting.db (the app opens DATA_DIR/voting.db)");
if (!fs.existsSync(file)) fail(2, `no database at ${file}`);
process.env.DATA_DIR = path.dirname(file);
process.env.DV_FREE_MOVE = "off"; // never start the legacy free-name mover from an ops tool

// Read-only preflight: the schema must be exactly what this release serves with.
const ro = new Database(file, { readonly: true, fileMustExist: true });
ro.pragma("busy_timeout = 5000");
{
  const hasTable = !!ro.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  const applied = hasTable ? (ro.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((r) => r.version) : [];
  const pending = MIGRATION_VERSIONS.filter((v) => !applied.includes(v));
  const unknown = applied.filter((v) => !MIGRATION_VERSIONS.includes(v));
  if (pending.length || unknown.length) fail(2, "schema does not match this release; run migrate.cjs first", { pending, unknown });
}

type UserRow = { id: number; username: string; display_name: string | null; role: string };
const userByName = ro.prepare("SELECT id, username, display_name, role FROM users WHERE username = ?");
const activeJobs = () =>
  ro.prepare("SELECT id, owner_id AS ownerId, state, phase, updated_at AS updatedAt FROM creation_jobs WHERE state IN ('queued','running','cancelling')").all();

if (cmd === "users") {
  out({ ok: true, users: ro.prepare("SELECT id, username, display_name, role FROM users ORDER BY id").all() });
} else if (cmd === "display-names") {
  displayNames();
} else {
  void createRounds();
}

function displayNames() {
  const sets = all("set");
  if (!sets.length) fail(2, "give at least one --set username=display name");
  const changes = sets.map((s) => {
    const eq = s.indexOf("=");
    if (eq < 1) fail(2, `bad --set ${JSON.stringify(s)}; expected username=display name`);
    const username = s.slice(0, eq).trim();
    const name = s.slice(eq + 1).trim().replace(/\s+/g, " ");
    if (name.length > 64) fail(2, `display name for ${username} is longer than 64 characters`);
    return { username, displayName: name || null };
  });
  const dupes = changes.map((c) => c.username).filter((u, i, a) => a.indexOf(u) !== i);
  if (dupes.length) fail(2, "the same username is given twice", { usernames: [...new Set(dupes)] });
  const rows = changes.map((c) => ({ ...c, row: userByName.get(c.username) as UserRow | undefined }));
  const missing = rows.filter((r) => !r.row).map((r) => r.username);
  if (missing.length) fail(2, "unknown usernames; nothing changed", { missing });
  const plan = rows.map((r) => ({ id: r.row!.id, username: r.username, before: r.row!.display_name, after: r.displayName, changed: r.row!.display_name !== r.displayName }));
  ro.close();
  if (dryRun) return out({ ok: true, dryRun: true, changes: plan });
  const db = getSqlite();
  const update = db.prepare("UPDATE users SET display_name = ? WHERE id = ? AND username = ?");
  db.transaction(() => {
    for (const p of plan) if (update.run(p.after, p.id, p.username).changes !== 1) throw new Error(`user ${p.username} changed underneath`);
  }).immediate();
  const after = plan.map((p) => db.prepare("SELECT id, username, display_name FROM users WHERE id = ?").get(p.id));
  db.close();
  out({ ok: true, dryRun: false, changes: plan, users: after });
}

/** The process cwd decides where the app looks for its worker file (lib/creation-jobs). Find a root that has it. */
function locateWorkerRoot() {
  const rel = path.join("src", "lib", "creation-worker.cjs");
  const candidates = [process.cwd(), "/app"];
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    candidates.push(dir);
    if (path.dirname(dir) === dir) break;
  }
  return candidates.find((dir) => fs.existsSync(path.join(dir, rel)));
}

async function createRounds() {
  const t0 = Date.now();
  const need = (k: string) => opt(k) ?? fail(2, `--${k} required`);
  const title = need("title").trim();
  const sets = need("sets").split(",").map((s) => s.trim()).filter(Boolean);
  const length = need("length");
  const size = Number(need("size"));
  const order = need("order");
  const assignNames = all("assign");
  const owner = userByName.get(need("owner")) as UserRow | undefined;
  if (!owner || owner.role !== "admin") fail(2, `--owner must be an existing admin username`);
  if (!assignNames.length) fail(2, "--assign required (the rounds are visible only to the assigned users)");
  const assignees = assignNames.map((u) => ({ u, row: userByName.get(u) as UserRow | undefined }));
  const missing = assignees.filter((a) => !a.row).map((a) => a.u);
  if (missing.length) fail(2, "unknown --assign usernames", { missing });
  if (!(BATCH_ORDERS as readonly string[]).includes(order)) fail(2, `--order must be one of ${BATCH_ORDERS.join(", ")}`);
  if (!Number.isSafeInteger(size) || size < 1) fail(2, "--size must be a positive integer");

  // Same filter normalisation as the form; count the block the way the form's live count does (excludeUsed on).
  const { filters, error } = normalizePoolFilters({ sets, setMode: "any", evidence: "any", includeUnpriced: "1", length, avail: "any", order });
  if (error) fail(2, `invalid filters: ${error}`);
  if (filters.length == null) fail(2, "--length must be 1..63");
  if (filters.sets.length !== sets.length) fail(2, "unknown set id in --sets", { given: sets, accepted: filters.sets });
  // Idempotency: the same arguments map to the same request key, whatever seed is drawn.
  const key = opt("key") ?? `ops-create-rounds-${crypto.createHash("sha256")
    .update(JSON.stringify([owner!.id, title, filters.sets, filters.length, size, order, assignees.map((a) => a.row!.id).sort((a, b) => a - b)]))
    .digest("hex").slice(0, 32)}`;
  const previous = ro.prepare("SELECT * FROM creation_jobs WHERE owner_id = ? AND request_key = ?").get(owner!.id, key) as CreationJob | undefined;
  if (previous) {
    // Same arguments ran before: report it, never submit a second copy.
    ro.close();
    if (["queued", "running", "cancelling"].includes(previous.state)) fail(4, "this request is already running", { job: previous.id, state: previous.state });
    if (previous.state !== "completed") fail(3, `an earlier run with these arguments ended ${previous.state}; pass --key to submit a new one`, { job: previous.id, error: previous.error });
    const result = report(previous.id, owner!.id, Date.now() - t0);
    return out({ ok: result.checks.ok, replay: true, ...result });
  }
  const seed = opt("seed") ?? String(Date.now() % 1_000_000);
  const where = blockWhere(filters, true);
  const block = (ro.prepare(`SELECT COUNT(*) AS n FROM pool p ${where.sql}`).get(...where.params) as { n: number }).n;
  if (!block) fail(2, "no names match (or all are already used in rounds)", { filters });
  const rounds = Math.ceil(block / size); // the form's "enough rounds" button

  // Exactly the fields /admin/rounds/batch posts (batch-form.tsx defaults: any set mode, any evidence, unpriced included,
  // used names excluded, no cap, availability any), with "leftover → extra rounds" so no name is dropped.
  const form = new FormData();
  form.set("kind", "batch");
  for (const s of filters.sets) form.append("sets", String(s));
  form.set("setMode", "any");
  form.set("evidence", "any");
  form.set("minUsd", "");
  form.set("maxUsd", "");
  form.set("includeUnpriced", "1");
  form.set("cap", "");
  form.set("excludeUsed", "1");
  form.set("length", String(filters.length));
  form.set("avail", "any");
  form.set("order", order);
  if (order === "random") form.set("seed", seed);
  form.set("rounds", String(rounds));
  form.set("perRound", String(size));
  form.set("remainderMode", "extra");
  form.set("title", title);
  for (const a of assignees) form.append("assignees", String(a.row!.id));
  form.set("createMode", "all");
  let input;
  try {
    input = creationInput(form, "batch");
  } catch (e) {
    fail(2, `rejected by the form validation: ${e instanceof Error ? e.message : e}`);
  }
  if (input.assignees.length !== assignees.length) fail(2, "assignee lookup mismatch");
  const plan = planBatch({ total: block, ...input.plan });
  const planned = {
    owner: owner!.username, assignees: assignees.map((a) => ({ id: a.row!.id, username: a.u })), title, seed, key,
    filters: { sets: filters.sets, length: filters.length, excludeUsed: true }, order, block, perRound: size,
    rounds: plan.sizes.length, sizes: plan.sizes, titles: plan.sizes.map((_, i) => `${title} · ${i + 1}/${plan.sizes.length}`),
  };
  const active = activeJobs() as Array<{ id: string }>;
  if (dryRun) {
    ro.close();
    return out({ ok: active.length === 0, dryRun: true, activeJobs: active, planned });
  }
  if (active.length) fail(4, "another creation job is active; nothing submitted", { activeJobs: active });
  ro.close();

  const root = locateWorkerRoot();
  if (!root) fail(2, "cannot find src/lib/creation-worker.cjs (run with the app directory, e.g. /app, as the working directory)");
  process.chdir(root);

  progress({ submit: planned.rounds, block, title });
  let id: string;
  try {
    id = acceptCreationJob(owner!.id, key, input);
  } catch (e) {
    const code = e instanceof Error ? e.message : String(e);
    if (code === "capacity") fail(4, "another creation job is active; nothing submitted", { activeJobs: activeJobs() });
    fail(2, code);
  }
  const db = getSqlite();
  const read = () => db.prepare("SELECT * FROM creation_jobs WHERE id = ?").get(id) as CreationJob;
  const worker = (globalThis as unknown as { dvCreationWorkers?: Map<string, Worker> }).dvCreationWorkers?.get(id);
  let interrupted = 0;
  const onSignal = () => {
    interrupted++;
    if (interrupted > 1) process.exit(130);
    progress({ signal: "cancelling (the worker removes what it created); interrupt again to leave it running for the app to resume" });
    try { changeCreationJob(id, owner!.id, "cancel"); } catch { /* best effort */ }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const exited = worker ? new Promise<void>((resolve) => worker.once("exit", () => resolve())) : Promise.resolve();
  const tick = setInterval(() => {
    const j = read();
    progress({ job: id, state: j.state, phase: j.phase, staged: j.staged, total: j.total, inserted: j.inserted, target: j.target });
  }, 5_000);
  await exited;
  // The worker's 'exit' handler in creation-jobs releases the lease; let it run before the final read.
  await new Promise((resolve) => setImmediate(resolve));
  clearInterval(tick);
  const job = read();
  if (job.state !== "completed") {
    fail(3, `creation job ended ${job.state}`, { job: id, phase: job.phase, error: job.error ?? (worker ? null : "worker_not_started"), ms: Date.now() - t0 });
  }
  const result = report(id, owner!.id, Date.now() - t0);
  db.close();
  out({ ok: result.checks.ok, replay: false, planned: { block, rounds: planned.rounds, seed }, ...result });
  if (!result.checks.ok) process.exit(3);
}

function report(jobId: string, ownerId: number, ms: number) {
  const db = getSqlite();
  const job = db.prepare("SELECT * FROM creation_jobs WHERE id = ? AND owner_id = ?").get(jobId, ownerId) as CreationJob & { batch_id: number };
  const rounds = db.prepare(
    `SELECT r.id, r.title, r.status, r.batch_index AS batchIndex, g.end_position - g.start_position + 1 AS size,
            (SELECT group_concat(u.username) FROM round_assignees ra JOIN users u ON u.id = ra.user_id WHERE ra.round_id = r.id) AS assignees
     FROM rounds r JOIN round_domain_ranges g ON g.round_id = r.id WHERE r.batch_id = ? ORDER BY r.batch_index`,
  ).all(job.batch_id) as Array<{ id: number; title: string; status: string; batchIndex: number; size: number; assignees: string | null }>;
  const selection = db.prepare("SELECT id FROM domain_selections WHERE batch_id = ?").get(job.batch_id) as { id: number } | undefined;
  const names = selection
    ? (db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT name) AS d FROM selection_items WHERE selection_id = ?").get(selection.id) as { n: number; d: number })
    : { n: 0, d: 0 };
  const total = rounds.reduce((s, r) => s + r.size, 0);
  const assigneeSets = [...new Set(rounds.map((r) => r.assignees ?? ""))];
  const checks = {
    sizesSumToStaged: total === names.n,
    noDuplicateNames: names.n === names.d,
    allOpen: rounds.every((r) => r.status === "open"),
    sameAssigneesEverywhere: assigneeSets.length === 1 && assigneeSets[0] !== "",
    ok: false,
  };
  checks.ok = checks.sizesSumToStaged && checks.noDuplicateNames && checks.allOpen && checks.sameAssigneesEverywhere;
  return { job: jobId, batchId: job.batch_id, resultUrl: job.result_url, rounds, roundCount: rounds.length, total, distinctNames: names.d, checks, ms };
}
