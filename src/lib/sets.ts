/**
 * Pool sets shown in the app. set_2 (Persian-sounding) is retired: it is a strict subset of set_3,
 * so it is hidden everywhere and any legacy reference to it (URLs, saved round/batch filters) means set 3.
 * The pool.set_2 column is kept; the importer still reads it.
 * Sets 6-8 (v19) are the name-screening verdicts for 5-letter names: 6 passed, 7 rejected, 8 offensive word.
 * They are mutually exclusive and 0 for every other name.
 */
export const ACTIVE_SETS = [1, 3, 4, 5, 6, 7, 8] as const;
/** The name-screening sets: a separate dimension from the phonetic sets 1-5, so they overlap those freely. */
export const SCREENING_SETS: readonly number[] = [6, 7, 8];
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

/** SQL for the comma list of active sets a row belongs to (e.g. "1,3"), as `sets`-style text. */
export function setListSql(alias: string) {
  return `rtrim(${ACTIVE_SETS.map((n) => `(CASE WHEN ${alias}.set_${n} = 1 THEN '${n},' ELSE '' END)`).join(" || ")}, ',')`;
}

/** SQL select list `SUM(alias.set_N) AS sN` for every active set. */
export function setSumsSql(alias?: string) {
  const a = alias ? `${alias}.` : "";
  return ACTIVE_SETS.map((n) => `SUM(${a}set_${n}) AS s${n}`).join(", ");
}
