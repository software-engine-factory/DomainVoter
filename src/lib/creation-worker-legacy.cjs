/* eslint-disable @typescript-eslint/no-require-imports */
// Dedicated local job writer. Never run a failed job inline on the web thread.
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createInterface } = require("node:readline");
const Database = require("better-sqlite3");
const { filename, directory, id, token } = workerData;
const db = new Database(filename, { fileMustExist: true });
const control = new Database(filename, { readonly: true, fileMustExist: true });
db.pragma("busy_timeout=0");
db.pragma("foreign_keys=ON");
db.pragma("cache_size=-20000");
db.pragma("temp_store=FILE");
control.pragma("busy_timeout=5000");
control.pragma("cache_size=-20000");
control.pragma("temp_store=FILE");
const rank = (seed, name) => {
  let h = 0x811c9dc5; const text = `${seed}:${name}`;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
db.function("dv_seeded_rank", { deterministic: true }, rank);
db.function("dv_browse_rank", { deterministic: true }, rank);
const read = () => control.prepare("SELECT * FROM creation_jobs WHERE id=?").get(id);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const error = code => Object.assign(new Error(code), { code });
const input = JSON.parse(read().input_json);
const chunkSize = workerData.chunkSize || 1000;
fs.mkdirSync(directory, { recursive: true });
const manifest = path.join(directory, `${id}.jsonl`);

async function retry(fn) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try { return fn(); } catch (e) {
      if (!String(e.code).startsWith("SQLITE_BUSY") || Date.now() > deadline) throw e;
      await wait(10);
    }
  }
}
function check() {
  const job = read();
  if (job.lease_token !== token) throw error("stale_worker");
  if (job.cancel_requested) throw error("cancelled");
  return job;
}
async function tx(fn, cleanup = false) {
  const start = performance.now();
  const result = await retry(db.transaction(() => {
    const job = db.prepare("SELECT lease_token,cancel_requested FROM creation_jobs WHERE id=?").get(id);
    if (job.lease_token !== token) throw error("stale_worker");
    if (!cleanup && job.cancel_requested) throw error("cancelled");
    return fn();
  }).immediate);
  // Leave time between writer reservations for interactive votes.
  await wait(Math.min(100, Math.max(5, performance.now() - start)));
  return result;
}
async function* chunks() {
  const stream = fs.createReadStream(manifest, { encoding: "utf8", highWaterMark: 64 * 1024 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let part = [];
  try {
    for await (const line of lines) {
      part.push(JSON.parse(line));
      if (part.length === chunkSize) { yield part; part = []; }
    }
    if (part.length) yield part;
  } finally { lines.close(); stream.destroy(); }
}
async function sealSelection() {
  const job = check();
  if (job.manifest_sha) {
    const hash = createHash("sha256");
    for await (const bytes of fs.createReadStream(manifest)) hash.update(bytes);
    if (hash.digest("hex") !== job.manifest_sha) throw error("manifest_changed");
    return;
  }
  const temp = manifest + ".partial";
  const fd = fs.openSync(temp, "w");
  let count = 0, buffer = "";
  const hash = createHash("sha256");
  const flush = () => { fs.writeSync(fd, buffer); hash.update(buffer); buffer = ""; check(); };
  try {
    for (const row of db.prepare(input.selectionSql).iterate(...input.params)) {
      buffer += JSON.stringify(row.name) + "\n";
      if (++count > 3_000_000) throw error("too_many_names");
      if (count % 2000 === 0) flush();
    }
    if (buffer) flush();
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (!count) throw error("no_matches");
  fs.renameSync(temp, manifest);
  const target = sizes(count).reduce((sum, n) => sum + n, 0);
  await tx(() => db.prepare("UPDATE creation_jobs SET total=?,target=?,manifest_sha=?,phase=?,updated_at=? WHERE id=?").run(count, target, hash.digest("hex"), input.kind === "batch" ? "staging" : "materializing", Date.now(), id));
}
function sizes(total) {
  if (input.kind !== "batch") return [total];
  const p = input.plan;
  const result = [];
  for (let i = 0; i < p.rounds && i * p.perRound < total; i++) result.push(Math.min(p.perRound, total - i * p.perRound));
  let left = Math.max(0, total - p.rounds * p.perRound);
  if (p.remainderMode === "last" && result.length) result[result.length - 1] += left;
  if (p.remainderMode === "extra") while (left > 0) {
    if (result.length >= 2000) throw error("too_many_rounds");
    result.push(Math.min(left, p.perRound)); left -= p.perRound;
  }
  return input.createFirst ? result.slice(0, 1) : result;
}
async function stageBatch() {
  let job = check();
  if (!job.batch_id) await tx(() => {
    const batch = db.prepare("INSERT INTO round_batches(title,filter_json,order_mode,seed,block_total,per_round,rounds_planned,remainder_mode,created_at,created_by,creation_job_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(input.title, input.filterJson, input.order, input.seed, job.total, input.plan.perRound, input.plan.rounds, input.plan.remainderMode, Date.now(), job.owner_id, id);
    const batchId = Number(batch.lastInsertRowid);
    for (const userId of input.assignees) db.prepare("INSERT INTO round_batch_assignees(batch_id,user_id) VALUES (?,?)").run(batchId, userId);
    db.prepare("UPDATE creation_jobs SET batch_id=? WHERE id=?").run(batchId, id);
  });
  job = check();
  let position = 0;
  for await (const part of chunks()) {
    check();
    const skip = Math.max(0, job.staged - position);
    const pending = part.slice(skip);
    if (pending.length) await tx(() => {
      const offset = position + skip;
      db.prepare("INSERT INTO round_batch_items(batch_id,position,name) SELECT ?,?+CAST(key AS INTEGER)+1,value FROM json_each(?)").run(job.batch_id, offset, JSON.stringify(pending));
      db.prepare("UPDATE creation_jobs SET staged=?,updated_at=? WHERE id=?").run(offset + pending.length, Date.now(), id);
    });
    position += part.length;
  }
  await tx(() => db.prepare("UPDATE creation_jobs SET phase='materializing',updated_at=? WHERE id=?").run(Date.now(), id));
}
async function createRound(job, index, count) {
  let row = db.prepare("SELECT id FROM rounds WHERE creation_job_id=? AND batch_index=?").get(id, index + 1);
  if (!row) await tx(() => {
    const title = input.kind === "batch" ? `${input.title} · ${index + 1}/${count}` : input.title;
    const info = db.prepare("INSERT INTO rounds(title,status,filter_json,sort_mode,created_at,source,batch_id,batch_index,creation_job_id) VALUES (?,'closed',?,?,?,'pool',?,?,?)")
      .run(title, input.filterJson, input.order, Date.now(), input.kind === "batch" ? job.batch_id : null, index + 1, id);
    row = { id: Number(info.lastInsertRowid) };
    for (const userId of input.assignees) db.prepare("INSERT INTO round_assignees(round_id,user_id) VALUES (?,?)").run(row.id, userId);
    if (input.kind !== "batch") db.prepare("UPDATE creation_jobs SET round_id=? WHERE id=?").run(row.id, id);
  });
  return row.id;
}
async function materialize() {
  const job = check(), plan = sizes(job.total);
  let start = 0;
  if (input.kind !== "batch") {
    const round = await createRound(job, 0, 1);
    let position = 0;
    for await (const part of chunks()) {
      check();
      const skip = Math.max(0, job.inserted - position), pending = part.slice(skip);
      if (pending.length) await tx(() => {
        const offset = position + skip;
        const n = db.prepare("INSERT INTO domains(round_id,position,name,price,is_premium,pool_name,currency) SELECT ?,?+CAST(j.key AS INTEGER)+1,p.name,COALESCE(p.lp_price,p.best_price),0,p.name,p.lp_currency FROM json_each(?) j JOIN pool p ON p.name=j.value ORDER BY CAST(j.key AS INTEGER)")
          .run(round, offset, JSON.stringify(pending)).changes;
        if (n !== pending.length) throw error("source_changed");
        db.prepare("UPDATE creation_jobs SET inserted=?,updated_at=? WHERE id=?").run(offset + n, Date.now(), id);
      });
      position += part.length;
    }
  } else for (let index = 0; index < plan.length; index++) {
    const stop = start + plan[index];
    const round = await createRound(job, index, plan.length);
    let done = Math.max(start, check().inserted);
    while (done < stop) {
      check();
      const end = Math.min(stop, done + chunkSize);
      await tx(() => {
        const n = db.prepare("INSERT INTO domains(round_id,position,name,price,is_premium,pool_name,currency) SELECT ?,i.position-?,p.name,COALESCE(p.lp_price,p.best_price),0,p.name,p.lp_currency FROM round_batch_items i JOIN pool p ON p.name=i.name WHERE i.batch_id=? AND i.position>? AND i.position<=? ORDER BY i.position")
          .run(round, start, job.batch_id, done, end).changes;
        if (n !== end - done) throw error("source_changed");
        db.prepare("UPDATE creation_jobs SET inserted=?,updated_at=? WHERE id=?").run(end, Date.now(), id);
      });
      done = end;
    }
    start = stop;
  }
  await tx(() => {
    db.prepare("UPDATE rounds SET status='open',opened_at=?,creation_job_id=NULL WHERE creation_job_id=?").run(Date.now(), id);
    if (input.kind === "batch") db.prepare("UPDATE round_batches SET creation_job_id=NULL WHERE id=?").run(job.batch_id);
    const result = input.kind === "batch" ? `/admin/rounds/batch/${job.batch_id}` : `/admin/rounds/${read().round_id}`;
    db.prepare("UPDATE creation_jobs SET state='completed',phase='done',result_url=?,updated_at=? WHERE id=?").run(result, Date.now(), id);
  });
}
async function cleanup() {
  const job = read();
  await tx(() => db.prepare("UPDATE creation_jobs SET phase='cleanup' WHERE id=?").run(id), true);
  for (;;) {
    const n = await tx(() => db.prepare("DELETE FROM domains WHERE id IN (SELECT d.id FROM domains d JOIN rounds r ON r.id=d.round_id WHERE r.creation_job_id=? LIMIT ?)").run(id, chunkSize).changes, true);
    if (!n) break;
  }
  if (job.batch_id) for (;;) {
    const n = await tx(() => db.prepare("DELETE FROM round_batch_items WHERE batch_id=? AND position IN (SELECT position FROM round_batch_items WHERE batch_id=? LIMIT ?)").run(job.batch_id, job.batch_id, chunkSize).changes, true);
    if (!n) break;
  }
  await tx(() => {
    db.prepare("DELETE FROM rounds WHERE creation_job_id=?").run(id);
    if (job.batch_id) db.prepare("DELETE FROM round_batches WHERE id=? AND creation_job_id=?").run(job.batch_id, id);
    db.prepare("UPDATE creation_jobs SET state='cancelled',updated_at=? WHERE id=?").run(Date.now(), id);
  }, true);
}
(async () => {
  try {
    check();
    await sealSelection();
    sizes(check().total); // Enforce round allocation bounds before any data writes.
    if (input.kind === "batch" && check().phase === "staging") await stageBatch();
    await materialize();
  } catch (e) {
    if (e.code === "stale_worker") return;
    if (e.code === "cancelled") await cleanup();
    else await retry(() => db.prepare("UPDATE creation_jobs SET state='failed',error=?,updated_at=? WHERE id=? AND lease_token=?").run(e.code || "creation_failed", Date.now(), id, token));
  } finally {
    const state = read().state;
    if (["completed", "cancelled"].includes(state)) for (const f of [manifest, manifest + ".partial"]) fs.rmSync(f, { force: true });
    control.close(); db.close();
  }
})().catch(() => process.exitCode = 1);
