import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { getSqlite } from "@/db";
import { dataDir } from "@/lib/paths";

export type CreationInput = {
  kind: "batch" | "pool" | "explore";
  title: string;
  selectionSql: string;
  params: unknown[];
  filterJson: string;
  order: string;
  seed: string | null;
  assignees: number[];
  plan: { rounds: number; perRound: number; remainderMode: "drop" | "last" | "extra" };
  createFirst: boolean;
};
export type CreationJob = {
  id: string; owner_id: number; state: string; phase: string; total: number;
  staged: number; target: number; inserted: number; cancel_requested: number; result_url: string | null;
  error: string | null; updated_at: number; lease_until: number; input_json: string;
};

const runtime = globalThis as unknown as { dvCreationWorkers?: Map<string, Worker> };
const workers = runtime.dvCreationWorkers ??= new Map();

export function sameCreationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    // Next dev normalizes request.url to localhost even when the browser uses 127.0.0.1.
    const url = new URL(origin);
    return url.host === (request.headers.get("host") ?? new URL(request.url).host) && url.protocol === new URL(request.url).protocol;
  } catch { return false; }
}

export function getCreationJob(id: string, owner: number) {
  return getSqlite().prepare("SELECT * FROM creation_jobs WHERE id = ? AND owner_id = ?").get(id, owner) as CreationJob | undefined;
}

/** Acceptance never scans the pool. The database index admits one heavy writer across callers. */
export function acceptCreationJob(owner: number, key: string, input: CreationInput) {
  const db = getSqlite();
  const json = JSON.stringify(input);
  const hash = createHash("sha256").update(json).digest("hex");
  const result = db.transaction(() => {
    const previous = db.prepare("SELECT id, input_hash FROM creation_jobs WHERE owner_id = ? AND request_key = ?").get(owner, key) as { id: string; input_hash: string } | undefined;
    if (previous) {
      if (previous.input_hash !== hash) throw new Error("idempotency_conflict");
      return previous.id;
    }
    if (db.prepare("SELECT 1 FROM creation_jobs WHERE state IN ('queued','running','cancelling')").get()) throw new Error("capacity");
    const id = randomUUID();
    const now = Date.now();
    db.prepare("INSERT INTO creation_jobs(id,owner_id,request_key,input_hash,input_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, owner, key, hash, json, now, now);
    return id;
  }).immediate();
  startCreationJob(result);
  return result;
}

/** A status read can reclaim an expired worker after a dev-server restart. Tokens fence old workers. */
export function startCreationJob(id: string) {
  if (workers.has(id)) return;
  const db = getSqlite();
  const token = randomUUID();
  const claimed = db.prepare("UPDATE creation_jobs SET lease_token=?, lease_until=?, state=CASE WHEN cancel_requested=1 THEN 'cancelling' ELSE 'running' END WHERE id=? AND state IN ('queued','running','cancelling') AND lease_until < ?")
    .run(token, Date.now() + 30_000, id, Date.now()).changes;
  if (!claimed) return;
  try {
    const worker = new Worker(path.join(/* turbopackIgnore: true */ process.cwd(), "src/lib/creation-worker.cjs"), {
      workerData: { filename: path.join(dataDir(), "voting.db"), directory: path.join(dataDir(), "creation-jobs"), id, token },
    });
    workers.set(id, worker);
    const heartbeat = setInterval(() => {
      try { db.prepare("UPDATE creation_jobs SET lease_until=? WHERE id=? AND lease_token=? AND state IN ('running','cancelling')").run(Date.now() + 30_000, id, token); } catch { /* Next status read will retry. */ }
    }, 5_000);
    heartbeat.unref();
    const finished = () => {
      clearInterval(heartbeat);
      workers.delete(id);
      db.prepare("UPDATE creation_jobs SET lease_until=0 WHERE id=? AND lease_token=?").run(id, token);
    };
    worker.on("error", () => {
      db.prepare("UPDATE creation_jobs SET state='failed',error='worker_unavailable',updated_at=? WHERE id=? AND lease_token=?").run(Date.now(), id, token);
    });
    worker.on("exit", finished);
  } catch {
    db.prepare("UPDATE creation_jobs SET state='failed',error='worker_unavailable',lease_until=0 WHERE id=? AND lease_token=?").run(id, token);
  }
}

export function changeCreationJob(id: string, owner: number, action: "cancel" | "retry") {
  const db = getSqlite();
  const row = getCreationJob(id, owner);
  if (!row) return false;
  if (action === "cancel" && row.state !== "completed" && row.state !== "cancelled") {
    db.prepare("UPDATE creation_jobs SET cancel_requested=1,state='cancelling',updated_at=? WHERE id=? AND owner_id=?").run(Date.now(), id, owner);
  } else if (action === "retry" && row.state === "failed") {
    if (db.prepare("SELECT 1 FROM creation_jobs WHERE state IN ('queued','running','cancelling')").get()) throw new Error("capacity");
    db.prepare("UPDATE creation_jobs SET state='queued',error=NULL,lease_until=0,cancel_requested=0,updated_at=? WHERE id=? AND owner_id=?").run(Date.now(), id, owner);
  }
  startCreationJob(id);
  return true;
}

export function creationSnapshot(row: CreationJob) {
  const input = JSON.parse(row.input_json) as CreationInput;
  return { id: row.id, title: input.title, state: row.state, phase: row.phase,
    total: row.phase === "staging" ? row.total : row.target, processed: row.phase === "staging" ? row.staged : row.inserted,
    cancelRequested: !!row.cancel_requested, resultUrl: row.result_url, error: row.error, updatedAt: row.updated_at };
}
