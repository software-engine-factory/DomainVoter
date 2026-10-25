/**
 * Pool sets shown in the app. set_2 (Persian-sounding) is retired: it is a strict subset of set_3,
 * so it is hidden everywhere and any legacy reference to it (URLs, saved round/batch filters) means set 3.
 * The pool.set_2 column is kept; the importer still reads it.
 */
export const ACTIVE_SETS = [1, 3, 4, 5] as const;
export const RETIRED_SET_ALIAS: Record<number, number> = { 2: 3 };

/** Map legacy ids (2 → 3), drop unknown ones, dedupe and sort. */
export function normalizeSetIds(values: unknown[]): number[] {
  const out = new Set<number>();
  for (const v of values) {
    let n = Number(v);
    if (!Number.isInteger(n)) continue;
    n = RETIRED_SET_ALIAS[n] ?? n;
    if ((ACTIVE_SETS as readonly number[]).includes(n)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
