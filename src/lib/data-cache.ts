import { getSqlite } from "@/db";

/**
 * In-process cache for whole-pool / whole-free_names aggregates (overview, facets, length counts,
 * import tags, filtered COUNTs). better-sqlite3 is synchronous, so a 1–2 s GROUP BY on ~540k pool /
 * ~1.9M free rows would stall every voter request; these only change when the data does.
 *
 * Stamp = latest finished import (app sync/upload and the ops import/undo CLI all write one)
 * + whether legacy free_names still holds rows (flips once the v14 mover has drained it into the pool)
 * + an in-process bump for app write paths that change pool rows without an imports row
 * (rollback by tag, free upload).
 */
type State = { bump: number; stamp: string; at: number; gen: number; values: Map<string, unknown>; counts: Map<string, number>; inflight: Map<string, Promise<unknown>> };
const g = globalThis as unknown as { dvDataCache?: State };
const state = (g.dvDataCache ??= { bump: 0, stamp: "", at: 0, gen: 0, values: new Map(), counts: new Map(), inflight: new Map() });
state.gen ??= 0;
state.inflight ??= new Map();

const COUNT_LIMIT = 500;

export function dataStamp() {
  const row = getSqlite()
    .prepare(
      `SELECT (SELECT COALESCE(MAX(id), 0) FROM imports WHERE finished_at IS NOT NULL) AS imp,
              EXISTS (SELECT 1 FROM free_names) AS free`,
    )
    .get() as { imp: number; free: number };
  return `${row.imp}.${row.free}.${state.bump}`;
}

function sync() {
  const stamp = dataStamp();
  if (stamp !== state.stamp) {
    state.stamp = stamp;
    clear();
  }
}

/** Call after any app write that changes pool / free_names rows outside an import. */
export function bumpData() {
  state.bump += 1;
  clear();
}

function clear() {
  state.gen += 1;
  state.values.clear();
  state.counts.clear();
  state.inflight.clear();
}

export function cached<T>(key: string, compute: () => T): T {
  sync();
  if (state.values.has(key)) return state.values.get(key) as T;
  const value = compute();
  state.values.set(key, value);
  return value;
}

/** Bounded cache for COUNT(*) by WHERE clause + params (oldest dropped first). */
export function cachedCount(table: string, sql: string, params: readonly unknown[], compute: () => number): number {
  sync();
  const key = `${table}|${sql}|${JSON.stringify(params)}`;
  const hit = state.counts.get(key);
  if (hit !== undefined) {
    state.counts.delete(key);
    state.counts.set(key, hit);
    return hit;
  }
  const n = compute();
  state.counts.set(key, n);
  if (state.counts.size > COUNT_LIMIT) state.counts.delete(state.counts.keys().next().value as string);
  return n;
}

/**
 * Async twin of `cached` for computations that run off-thread (lib/ro). Concurrent callers share one
 * computation; a result that finishes after the data changed is returned but never stored.
 */
export function cachedAsync<T>(key: string, compute: () => Promise<T>): Promise<T> {
  sync();
  if (state.values.has(key)) return Promise.resolve(state.values.get(key) as T);
  const running = state.inflight.get(key);
  if (running) return running as Promise<T>;
  const gen = state.gen;
  const p = compute().then(
    (value) => {
      if (state.gen === gen) {
        state.values.set(key, value);
        state.inflight.delete(key);
      }
      return value;
    },
    (err) => {
      if (state.gen === gen) state.inflight.delete(key);
      throw err;
    },
  );
  state.inflight.set(key, p);
  return p;
}

export async function cachedCountAsync(table: string, sql: string, params: readonly unknown[], compute: () => Promise<number>): Promise<number> {
  sync();
  const key = `${table}|${sql}|${JSON.stringify(params)}`;
  const hit = state.counts.get(key);
  if (hit !== undefined) {
    state.counts.delete(key);
    state.counts.set(key, hit);
    return hit;
  }
  const gen = state.gen;
  const n = await cachedAsync(`count:${key}`, compute);
  if (state.gen === gen) {
    state.values.delete(`count:${key}`);
    state.counts.set(key, n);
    if (state.counts.size > COUNT_LIMIT) state.counts.delete(state.counts.keys().next().value as string);
  }
  return n;
}
