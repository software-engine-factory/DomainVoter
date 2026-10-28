// Research-only read worker. All rows stay in ignored scratch files; IPC returns
// only aggregate metadata. Close the SQLite snapshot before main-thread writes.
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const Database = require(workerData.mod);
let db;
let fd;
try {
  db = new Database(workerData.file, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  db.function("dv_seeded_rank", { deterministic: true }, (seed, name) => {
    let h = 0x811c9dc5;
    const text = String(seed) + ":" + String(name);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  });
  fd = fs.openSync(workerData.output, "wx");
  let rows = 0;
  let pending = [];
  let bytes = 0;
  const flush = () => {
    if (!pending.length) return;
    const out = pending.join("");
    bytes += Buffer.byteLength(out);
    fs.writeFileSync(fd, out);
    pending = [];
  };
  for (const row of db.prepare(workerData.sql).iterate(...workerData.params)) {
    pending.push(JSON.stringify(row) + "\n");
    rows++;
    if (pending.length === 2000) flush();
  }
  flush();
  db.close();
  db = null;
  fs.closeSync(fd);
  fd = null;
  parentPort.postMessage({ ok: true, rows, bytes });
} catch (error) {
  try { db?.close(); } catch {}
  try { if (fd != null) fs.closeSync(fd); } catch {}
  parentPort.postMessage({ ok: false, error: error.message });
}
