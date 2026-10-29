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
const chunkSize = workerData.chunkSize || 2000;
const maxManifestBytes = 512 * 1024 * 1024;
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
const leaseCheck = db.prepare("SELECT lease_token,cancel_requested FROM creation_jobs WHERE id=?");
const writerTransaction = db.transaction(fn => fn());
const insertSelectionChunk = db.prepare(`INSERT INTO selection_items(selection_id,position,name,price,currency)
  SELECT ?,?+CAST(j.key AS INTEGER)+1,p.name,COALESCE(p.lp_price,p.best_price),p.lp_currency
  FROM json_each(?) j JOIN pool p ON p.name=j.value ORDER BY CAST(j.key AS INTEGER)`);
const updateStaged = db.prepare("UPDATE creation_jobs SET staged=?,updated_at=? WHERE id=?");
function check() {
  const job = read();
  if (job.lease_token !== token) throw error("stale_worker");
  if (job.cancel_requested) throw error("cancelled");
  return job;
}
async function tx(fn, cleanup = false) {
  const start = performance.now();
  const result = await retry(() => writerTransaction.immediate(() => {
    const job = leaseCheck.get(id);
    if (job.lease_token !== token) throw error("stale_worker");
    if (!cleanup && job.cancel_requested) throw error("cancelled");
    return fn();
  }));
  // Leave time between writer reservations for interactive votes.
  await wait(Math.min(15, Math.max(2, (performance.now() - start) * 0.25)));
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
  let count = 0, buffer = "", manifestBytes = 0;
  const hash = createHash("sha256");
  const flush = () => { fs.writeSync(fd, buffer); hash.update(buffer); buffer = ""; check(); };
  try {
    for (const row of db.prepare(input.selectionSql).iterate(...input.params)) {
      const line = JSON.stringify(row.name) + "\n";
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lineBytes > 2048) throw error("selection_name_too_long");
      manifestBytes += lineBytes;
      if (manifestBytes > maxManifestBytes) throw error("selection_manifest_too_large");
      buffer += line;
      if (++count > 3_000_000) throw error("too_many_names");
      if (count % 2000 === 0) flush();
    }
    if (buffer) flush();
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (!count) throw error("no_matches");
  fs.renameSync(temp, manifest);
  const target = sizes(count).reduce((sum, n) => sum + n, 0);
  await tx(() => db.prepare("UPDATE creation_jobs SET total=?,target=?,manifest_sha=?,phase='staging',updated_at=? WHERE id=?").run(count, target, hash.digest("hex"), Date.now(), id));
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
async function stageSelection() {
  let job = check();
  if (!db.prepare("SELECT 1 FROM domain_selections WHERE creation_job_id=?").get(id)) await tx(() => {
    let batchId = job.batch_id;
    if (input.kind === "batch" && !batchId) {
      const batch = db.prepare("INSERT INTO round_batches(title,filter_json,order_mode,seed,block_total,per_round,rounds_planned,remainder_mode,created_at,created_by,creation_job_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(input.title, input.filterJson, input.order, input.seed, job.total, input.plan.perRound, input.plan.rounds, input.plan.remainderMode, Date.now(), job.owner_id, id);
      batchId = Number(batch.lastInsertRowid);
      for (const userId of input.assignees) db.prepare("INSERT INTO round_batch_assignees(batch_id,user_id) VALUES (?,?)").run(batchId, userId);
    }
    db.prepare("INSERT INTO domain_selections(creation_job_id,batch_id) VALUES (?,?)").run(id, batchId);
    db.prepare("UPDATE creation_jobs SET batch_id=? WHERE id=?").run(batchId, id);
  });
  job = check();
  const selectionId = db.prepare("SELECT id FROM domain_selections WHERE creation_job_id=?").get(id).id;
  let position = 0;
  for await (const part of chunks()) {
    check();
    const skip = Math.max(0, job.staged - position);
    const pending = part.slice(skip);
    if (pending.length) await tx(() => {
      const offset = position + skip;
      const n = insertSelectionChunk.run(selectionId, offset, JSON.stringify(pending)).changes;
      if (n !== pending.length) throw error("source_changed");
      updateStaged.run(offset + pending.length, Date.now(), id);
    });
    position += part.length;
  }
  await tx(() => db.prepare("UPDATE creation_jobs SET phase='materializing',updated_at=? WHERE id=?").run(Date.now(), id));
}
async function createRound(job, index, count, selectionId, start, size) {
  let row = db.prepare("SELECT id FROM rounds WHERE creation_job_id=? AND batch_index=?").get(id, index + 1);
  if (!row) {
    check();
    // This indexed scan may cover a large round. Keep it on the readonly connection so it
    // does not hold SQLite's writer reservation while voters submit votes.
    const range = control.prepare(`WITH lengths AS MATERIALIZED (
        SELECT instr(name || '.', '.') - 1 AS length FROM selection_items
        WHERE selection_id=? AND position BETWEEN ? AND ?
      )
      SELECT MIN(length) AS len_min, MAX(length) AS len_max,
        (SELECT length FROM (SELECT length,COUNT(*) AS n FROM lengths
          GROUP BY length ORDER BY n DESC, length ASC LIMIT 1)) AS label_length
      FROM lengths`).get(selectionId, start + 1, start + size);
    await tx(() => {
      const title = input.kind === "batch" ? `${input.title} · ${index + 1}/${count}` : input.title;
      const info = db.prepare("INSERT INTO rounds(title,status,filter_json,sort_mode,created_at,source,batch_id,batch_index,creation_job_id) VALUES (?,'closed',?,?,?,'pool',?,?,?)")
        .run(title, input.filterJson, input.order, Date.now(), input.kind === "batch" ? job.batch_id : null, index + 1, id);
      row = { id: Number(info.lastInsertRowid) };
      for (const userId of input.assignees) db.prepare("INSERT INTO round_assignees(round_id,user_id) VALUES (?,?)").run(row.id, userId);
      if (input.kind !== "batch") db.prepare("UPDATE creation_jobs SET round_id=? WHERE id=?").run(row.id, id);
      db.prepare(`INSERT INTO round_domain_ranges(round_id,selection_id,start_position,end_position,len_min,len_max,label_length)
        VALUES (?,?,?,?,?,?,?)`).run(row.id, selectionId, start + 1, start + size, range.len_min, range.len_max, range.label_length);
    });
  }
  return row.id;
}
async function materialize() {
  const job = check(), plan = sizes(job.total);
  let start = 0;
  const selectionId = db.prepare("SELECT id FROM domain_selections WHERE creation_job_id=?").get(id).id;
  if (input.kind !== "batch") {
    await createRound(job, 0, 1, selectionId, 0, plan[0]);
    await tx(() => db.prepare("UPDATE creation_jobs SET inserted=?,updated_at=? WHERE id=?").run(plan[0], Date.now(), id));
  } else for (let index = 0; index < plan.length; index++) {
    await createRound(job, index, plan.length, selectionId, start, plan[index]);
    start += plan[index];
    await tx(() => db.prepare("UPDATE creation_jobs SET inserted=?,updated_at=? WHERE id=?").run(start, Date.now(), id));
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
  const selection = db.prepare("SELECT id FROM domain_selections WHERE creation_job_id=?").get(id);
  if (selection) for (;;) {
    const n = await tx(() => db.prepare("DELETE FROM selection_items WHERE id IN (SELECT id FROM selection_items WHERE selection_id=? LIMIT ?)").run(selection.id, chunkSize).changes, true);
    if (!n) break;
  }
  await tx(() => {
    db.prepare("DELETE FROM rounds WHERE creation_job_id=?").run(id);
    if (job.batch_id) db.prepare("DELETE FROM round_batches WHERE id=? AND creation_job_id=?").run(job.batch_id, id);
    db.prepare("DELETE FROM domain_selections WHERE creation_job_id=?").run(id);
    db.prepare("UPDATE creation_jobs SET state='cancelled',updated_at=? WHERE id=?").run(Date.now(), id);
  }, true);
}
(async () => {
  try {
    check();
    await sealSelection();
    sizes(check().total); // Enforce round allocation bounds before any data writes.
    if (check().phase === "staging") await stageSelection();
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
