import path from "path";
import { createRequire } from "module";
import { Worker } from "worker_threads";
import { getSqlite } from "@/db";
import { dataDir } from "@/lib/paths";

/**
 * Off-thread reads. better-sqlite3 is synchronous, so a multi-second admin GROUP BY / sort on the main
 * connection stalls every voter request in the same Node process. Heavy admin reads go through `reader`
 * instead: in production a small pool of worker threads, each with its own read-only connection (WAL lets
 * them read while the main connection writes). Elsewhere, or if a worker cannot start, the same calls run
 * inline on the main connection, so behaviour is identical, only the thread differs.
 */
export type Params = readonly unknown[];
export type Reader = {
  all<T>(sql: string, params?: Params): Promise<T[]>;
  get<T>(sql: string, params?: Params): Promise<T | undefined>;
  /** Rows in chunks, for exports; the worker walks the cursor, the main thread only receives batches. */
  chunks<T>(sql: string, params?: Params, size?: number): AsyncGenerator<T[]>;
};

/** FNV-1a over seed + name: the same function as dv_seeded_rank / dv_browse_rank on the main connection. */
const RANK_SRC = `function dvRank(seed, name) { let h = 0x811c9dc5; const text = String(seed) + ":" + String(name);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }`;

const WORKER_SRC = `
const { parentPort, workerData } = require("worker_threads");
const Database = require(workerData.mod);
const db = new Database(workerData.file, { readonly: true, fileMustExist: true });
db.pragma("busy_timeout = 5000");
${RANK_SRC}
db.function("dv_seeded_rank", { deterministic: true }, dvRank);
db.function("dv_browse_rank", { deterministic: true }, dvRank);
const stmts = new Map();
function stmt(sql) {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); if (stmts.size > 300) stmts.delete(stmts.keys().next().value); }
  return s;
}
parentPort.on("message", (m) => {
  try {
    const s = stmt(m.sql);
    if (m.op === "chunks") {
      let buf = [];
      for (const row of s.iterate(...m.params)) { buf.push(row); if (buf.length >= m.size) { parentPort.postMessage({ id: m.id, ok: true, chunk: buf }); buf = []; } }
      parentPort.postMessage({ id: m.id, ok: true, chunk: buf, done: true });
    } else {
      parentPort.postMessage({ id: m.id, ok: true, r: m.op === "all" ? s.all(...m.params) : s.get(...m.params) });
    }
  } catch (e) { parentPort.postMessage({ id: m.id, ok: false, e: String((e && e.message) || e) }); }
});
parentPort.postMessage({ ready: true });
`;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onChunk?: (rows: unknown[], done: boolean) => void };
type Slot = { worker: Worker; pending: Map<number, Pending>; dead: boolean };

const withRank = new WeakSet<object>();
function inlineFunctions() {
  const sqlite = getSqlite();
  if (withRank.has(sqlite)) return sqlite;
  withRank.add(sqlite);
  const rank = new Function(`${RANK_SRC}; return dvRank;`)() as (s: unknown, n: unknown) => number;
  sqlite.function("dv_seeded_rank", { deterministic: true }, rank);
  sqlite.function("dv_browse_rank", { deterministic: true }, rank);
  return sqlite;
}

export function inlineReader(): Reader {
  return {
    async all<T>(sql: string, params: Params = []) {
      return inlineFunctions().prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: Params = []) {
      return inlineFunctions().prepare(sql).get(...params) as T | undefined;
    },
    async *chunks<T>(sql: string, params: Params = [], size = 2000) {
      let buf: T[] = [];
      for (const row of inlineFunctions().prepare(sql).iterate(...params) as IterableIterator<T>) {
        buf.push(row);
        if (buf.length >= size) {
          yield buf;
          buf = [];
        }
      }
      yield buf;
    },
  };
}

/** A reader backed by `count` worker threads (least-busy first). Falls back to inline if a worker dies. */
export function workerReader(count = 2): Reader {
  getSqlite(); // the main connection creates the file and runs migrations first
  const file = path.join(dataDir(), "voting.db");
  const mod = createRequire(path.join(/* turbopackIgnore: true */ process.cwd(), "package.json")).resolve("better-sqlite3");
  const fallback = inlineReader();
  let seq = 0;
  const slots: Slot[] = [];
  const spawn = (): Slot => {
    const slot: Slot = { worker: new Worker(WORKER_SRC, { eval: true, workerData: { file, mod } }), pending: new Map(), dead: false };
    slot.worker.on("message", (m: { id?: number; ok?: boolean; r?: unknown; e?: string; chunk?: unknown[]; done?: boolean }) => {
      if (m.id == null) return;
      const p = slot.pending.get(m.id);
      if (!p) return;
      if (!m.ok) {
        slot.pending.delete(m.id);
        p.reject(new Error(m.e));
      } else if (m.chunk) {
        p.onChunk?.(m.chunk, !!m.done);
        if (m.done) {
          slot.pending.delete(m.id);
          p.resolve(undefined);
        }
      } else {
        slot.pending.delete(m.id);
        p.resolve(m.r);
      }
    });
    const die = (err: unknown) => {
      if (slot.dead) return;
      slot.dead = true;
      console.error("[ro] worker stopped; falling back to inline reads", err);
      for (const p of slot.pending.values()) p.reject(err instanceof Error ? err : new Error(String(err)));
      slot.pending.clear();
    };
    slot.worker.on("error", die);
    slot.worker.on("exit", (code) => die(new Error(`exit ${code}`)));
    // Idle workers never keep the process alive (unref after the listeners: adding one re-refs the port);
    // a worker with a request in flight does, so a pending read is never dropped by an exiting process.
    slot.worker.unref();
    return slot;
  };
  try {
    for (let i = 0; i < count; i++) slots.push(spawn());
  } catch (err) {
    console.error("[ro] worker unavailable; inline reads", err);
    return fallback;
  }
  const pick = () => slots.filter((s) => !s.dead).sort((a, b) => a.pending.size - b.pending.size)[0];
  const send = (op: string, sql: string, params: Params, extra: Partial<Pending> & { size?: number } = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const slot = pick();
      if (!slot) return reject(new Error("no worker"));
      const id = ++seq;
      const idle = () => {
        if (slot.pending.size === 0) slot.worker.unref();
      };
      if (slot.pending.size === 0) slot.worker.ref();
      slot.pending.set(id, {
        resolve: (v) => {
          resolve(v);
          idle();
        },
        reject: (e) => {
          reject(e);
          idle();
        },
        onChunk: extra.onChunk,
      });
      slot.worker.postMessage({ id, op, sql, params: [...params], size: extra.size });
    });
  const threaded: Reader = {
    async all<T>(sql: string, params: Params = []) {
      if (!pick()) return fallback.all<T>(sql, params);
      return (await send("all", sql, params)) as T[];
    },
    async get<T>(sql: string, params: Params = []) {
      if (!pick()) return fallback.get<T>(sql, params);
      return (await send("get", sql, params)) as T | undefined;
    },
    async *chunks<T>(sql: string, params: Params = [], size = 2000) {
      if (!pick()) {
        yield* fallback.chunks<T>(sql, params, size);
        return;
      }
      const queue: T[][] = [];
      let finished = false;
      let failed: unknown = null;
      let wake: (() => void) | null = null;
      send("chunks", sql, params, {
        size,
        onChunk: (rows) => {
          queue.push(rows as T[]);
          wake?.();
        },
      }).then(
        () => {
          finished = true;
          wake?.();
        },
        (e) => {
          failed = e;
          wake?.();
        },
      );
      for (;;) {
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (failed) throw failed;
        if (finished) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
  (threaded as ThreadedMark)[THREADED] = true;
  return threaded;
}

// A plain property rather than a module-level set: instrumentation and routes can load separate copies of this module.
const THREADED = Symbol.for("dv.reader.threaded");
type ThreadedMark = Reader & { [THREADED]?: boolean };

const g = globalThis as unknown as { dvReader?: Reader };

/** True when `reader()` runs in worker threads, so long reads do not block the main thread. */
export function readerThreaded() {
  return (reader() as ThreadedMark)[THREADED] === true;
}

/** Workers in production (DV_RO_WORKERS=0 turns them off), inline elsewhere unless DV_RO_WORKERS>0. */
export function reader(): Reader {
  if (g.dvReader) return g.dvReader;
  const env = process.env.DV_RO_WORKERS;
  const n = env != null && env !== "" ? Number(env) : process.env.NODE_ENV === "production" ? 2 : 0;
  g.dvReader = Number.isInteger(n) && n > 0 ? workerReader(n) : inlineReader();
  return g.dvReader;
}
