// Tiny transport check. Oracle: 2005 synthetic rows in numeric lexical order,
// with their original prices retained even after the source is edited.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { replaySpool } from "./spool-reader.mjs";

const scratch = path.resolve(import.meta.dirname, "../../../data/perf-sql");
fs.mkdirSync(scratch, { recursive: true });
const file = path.join(scratch, `smoke-${randomUUID()}.db`);
const output = file + ".jsonl";
const db = new Database(file);
try {
  db.exec("CREATE TABLE sample(name TEXT PRIMARY KEY,price INTEGER)");
  const insert = db.prepare("INSERT INTO sample VALUES(?,?)");
  db.transaction(() => { for (let i = 2004; i >= 0; i--) insert.run(`s${String(i).padStart(4, "0")}.example`, i); })();
  const meta = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(import.meta.dirname, "spool-worker.cjs"), { workerData: { mod: createRequire(import.meta.url).resolve("better-sqlite3"), file, output, sql: "SELECT name,price FROM sample ORDER BY name", params: [] } });
    worker.once("message", (m) => m.ok ? resolve(m) : reject(new Error(m.error)));
    worker.once("error", reject);
  });
  db.exec("UPDATE sample SET price=-1");
  const rows = [];
  let chunks = 0;
  for await (const chunk of replaySpool(output, 250)) {
    assert.ok(chunk.length <= 250);
    chunks++;
    rows.push(...chunk);
  }
  assert.equal(meta.rows, 2005);
  assert.ok(meta.bytes > 65536, "crosses replay byte buffer boundary");
  assert.equal(rows.length, 2005);
  assert.equal(chunks, 9);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].name, `s${String(i).padStart(4, "0")}.example`);
    assert.equal(rows[i].price, i);
  }
  assert.equal(db.prepare("SELECT count(*) n FROM sample WHERE price=-1").get().n, 2005);
  console.log(JSON.stringify({ pass: true, rows: rows.length, chunks, bytes: meta.bytes, originalPricesFrozen: true }));
} finally {
  db.close();
  for (const p of [file, output]) if (fs.existsSync(p)) fs.rmSync(p);
}
