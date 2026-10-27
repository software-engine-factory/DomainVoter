import { getSqlite } from "@/db";

/**
 * In-process cache for whole-pool / whole-free_names aggregates (overview, facets, length counts,
 * import tags, filtered COUNTs). better-sqlite3 is synchronous, so a 1–2 s GROUP BY on ~540k pool /
 * ~1.9M free rows would stall every voter request; these only change when the data does.
 *
 * Stamp = latest finished import (app sync/upload and the ops import/undo CLI all write one)
 * + free_names max rowid (free CSV uploads) + an in-process bump for app write paths that
 * change pool/free rows without an imports row (rollback by tag, free upload).
 */
const g = globalThis as unknown as { dvDataCache?: { bump: number; stamp: string; at: number; values: Map<string, unknown>; counts: Map<string, number> } };
const state = (g.dvDataCache ??= { bump: 0, stamp: "", at: 0, values: new Map(), counts: new Map() });

const COUNT_LIMIT = 500;

export function dataStamp() {
  const row = getSqlite()
    .prepare(
      `SELECT (SELECT COALESCE(MAX(id), 0) FROM imports WHERE finished_at IS NOT NULL) AS imp,
              (SELECT COALESCE(MAX(rowid), 0) FROM free_names) AS free`,
    )
    .get() as { imp: number; free: number };
  return `${row.imp}.${row.free}.${state.bump}`;
}

function sync() {
  const stamp = dataStamp();
  if (stamp !== state.stamp) {
    state.stamp = stamp;
    state.values.clear();
    state.counts.clear();
  }
}

/** Call after any app write that changes pool / free_names rows outside an import. */
export function bumpData() {
  state.bump += 1;
  state.values.clear();
  state.counts.clear();
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
