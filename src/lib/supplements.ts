import { getSqlite } from "@/db";
import { ensureFunctions } from "@/lib/batches";
import { normalizePoolFilters, poolWhere, type PoolFilters } from "@/lib/pool";

/**
 * Option (b): late-imported names (one import_tag, e.g. "4L-gap-2026-10-26") are appended to EXISTING rounds
 * as a flagged segment after the frozen order. Nothing already in a round moves: positions, seeds, votes and
 * views of the core are untouched. Supplement names get positions max+1…, domains.segment = tag.
 *
 * Which names: the round's own stored filters (+ its label length) AND import_tag = tag, minus names already in it.
 * Order: the round's seed (dv_seeded_rank) when it has one, else name. Batch rounds: the batch's matching names
 * are ordered once with the batch seed and split evenly across its opened rounds in batch_index order
 * (no name lands in two rounds of one batch). round_batch_items (the frozen block) is never touched.
 */
export type SupplementPlanRow = {
  roundId: number;
  title: string;
  status: string;
  batchId: number | null;
  core: number;
  existing: number; // already appended for this tag
  add: string[];
  skip?: "csv" | "explore" | "derived" | "done" | "none";
};

type RoundRow = { id: number; parentId: number | null; title: string; status: string; filterJson: string | null; source: string; batchId: number | null; batchIndex: number | null; batchSeed: string | null; batchFilter: string | null; batchOrder: string | null };

function rounds() {
  return getSqlite()
    .prepare(
      `SELECT r.id, r.parent_round_id AS parentId, r.title, r.status, r.filter_json AS filterJson, r.source, r.batch_id AS batchId, r.batch_index AS batchIndex,
              b.seed AS batchSeed, b.filter_json AS batchFilter, b.order_mode AS batchOrder
       FROM rounds r LEFT JOIN round_batches b ON b.id = r.batch_id ORDER BY r.id`,
    )
    .all() as RoundRow[];
}

function labelLength(roundId: number) {
  const r = getSqlite()
    .prepare("SELECT instr(name || '.', '.') - 1 AS len, COUNT(*) n FROM domains WHERE round_id = ? AND segment IS NULL GROUP BY len ORDER BY n DESC LIMIT 1")
    .get(roundId) as { len: number } | undefined;
  return r?.len ?? null;
}

/** null filter_json on a pool round = the whole pool (older rounds, e.g. prod round 1). */
function parseFilters(json: string | null): { filters: PoolFilters; seed: string | null } | null {
  if (!json) return { filters: normalizePoolFilters({}).filters, seed: null };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || "explore" in raw) return null;
  const { filters } = normalizePoolFilters(raw);
  return { filters, seed: typeof raw.seed === "string" && raw.seed ? raw.seed : null };
}

/** Candidate names for one filter set, in seeded order, excluding names already in `excludeRounds`. */
function candidates(filters: PoolFilters, length: number | null, tag: string, seed: string | null, excludeRounds: number[]) {
  ensureFunctions();
  const where = poolWhere({ ...filters, length: length ?? filters.length ?? null });
  const extra = [`p.import_tag = ?`, `p.name NOT IN (SELECT name FROM domains WHERE round_id IN (${excludeRounds.map(() => "?").join(",") || "NULL"}))`];
  const sql = where.sql ? `${where.sql} AND ${extra.join(" AND ")}` : `WHERE ${extra.join(" AND ")}`;
  const order = seed ? "dv_seeded_rank(?, p.name), p.name" : "p.name";
  return (
    getSqlite()
      .prepare(`SELECT p.name FROM pool p ${sql} ORDER BY ${order}`)
      .all(...where.params, tag, ...excludeRounds, ...(seed ? [seed] : [])) as Array<{ name: string }>
  ).map((r) => r.name);
}

function counts(roundId: number, tag: string) {
  return getSqlite()
    .prepare("SELECT SUM(segment IS NULL) AS core, SUM(segment = ?) AS existing FROM domains WHERE round_id = ?")
    .get(tag, roundId) as { core: number | null; existing: number | null };
}

/** Dry run: what each round would receive. Pure read. */
export function planSupplement(tag: string): SupplementPlanRow[] {
  const all = rounds();
  const out: SupplementPlanRow[] = [];
  const batches = new Map<number, RoundRow[]>();
  for (const r of all) {
    if (r.batchId != null) {
      batches.set(r.batchId, [...(batches.get(r.batchId) ?? []), r]);
      continue;
    }
    const c = counts(r.id, tag);
    const base = { roundId: r.id, title: r.title, status: r.status, batchId: null, core: c.core ?? 0, existing: c.existing ?? 0 };
    if (r.source !== "pool") {
      out.push({ ...base, add: [], skip: "csv" });
      continue;
    }
    if (r.parentId != null) {
      // Derived rounds hold round filters, not pool filters; they pick names up when derived again.
      out.push({ ...base, add: [], skip: "derived" });
      continue;
    }
    const f = parseFilters(r.filterJson);
    if (!f) {
      out.push({ ...base, add: [], skip: "explore" });
      continue;
    }
    if (base.existing) {
      out.push({ ...base, add: [], skip: "done" });
      continue;
    }
    const add = candidates(f.filters, labelLength(r.id), tag, f.seed, [r.id]);
    out.push({ ...base, add, skip: add.length ? undefined : "none" });
  }
  for (const [, members] of batches) {
    members.sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
    const f = parseFilters(members[0].batchFilter);
    const ids = members.map((m) => m.id);
    const already = members.some((m) => (counts(m.id, tag).existing ?? 0) > 0);
    const names = f && !already ? candidates(f.filters, labelLength(ids[0]), tag, members[0].batchOrder === "random" ? members[0].batchSeed : null, ids) : [];
    // Contiguous chunks of the seeded list, as even as possible across the opened rounds (first rounds take the remainder).
    const k = members.length;
    const sizes = members.map((_, i) => Math.floor(names.length / k) + (i < names.length % k ? 1 : 0));
    let at = 0;
    members.forEach((m, i) => {
      const c = counts(m.id, tag);
      const take = sizes[i] ?? 0;
      const add = names.slice(at, at + take);
      at += take;
      out.push({
        roundId: m.id, title: m.title, status: m.status, batchId: m.batchId, core: c.core ?? 0, existing: c.existing ?? 0, add,
        skip: !f ? "explore" : already ? "done" : add.length ? undefined : "none",
      });
    });
  }
  return out.sort((a, b) => a.roundId - b.roundId);
}

/** Appends the planned names after each round's last position, flagged with the tag. Idempotent per (round, tag). */
export function applySupplement(tag: string, adminId: number | null, onlyRounds?: number[]) {
  const sqlite = getSqlite();
  const plan = planSupplement(tag).filter((p) => p.add.length && (!onlyRounds || onlyRounds.includes(p.roundId)));
  const now = Date.now();
  return sqlite.transaction(() => {
    let total = 0;
    const ins = sqlite.prepare(
      `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency, segment)
       SELECT ?, ?, p.name, COALESCE(p.lp_price, p.best_price), 0, NULL, p.name,
              CASE WHEN p.lp_price IS NOT NULL THEN p.lp_currency ELSE COALESCE(p.best_currency, p.lp_currency) END, ? FROM pool p WHERE p.name = ?`,
    );
    for (const p of plan) {
      const max = (sqlite.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM domains WHERE round_id = ?").get(p.roundId) as { m: number }).m;
      p.add.forEach((name, i) => ins.run(p.roundId, max + 1 + i, tag, name));
      sqlite
        .prepare("INSERT INTO round_supplements (round_id, tag, first_position, added, seed, created_at, created_by) VALUES (?, ?, ?, ?, NULL, ?, ?)")
        .run(p.roundId, tag, max + 1, p.add.length, now, adminId);
      total += p.add.length;
    }
    return { rounds: plan.length, names: total };
  })();
}

/** Undo for one tag: removes supplement rows nobody has voted on or viewed yet. */
export function removeSupplement(tag: string) {
  const sqlite = getSqlite();
  return sqlite.transaction(() => {
    const removed = sqlite
      .prepare(
        `DELETE FROM domains WHERE segment = ?
           AND id NOT IN (SELECT domain_id FROM votes) AND id NOT IN (SELECT domain_id FROM views)`,
      )
      .run(tag).changes;
    sqlite.prepare("DELETE FROM round_supplements WHERE tag = ? AND round_id NOT IN (SELECT round_id FROM domains WHERE segment = ?)").run(tag, tag);
    return removed;
  })();
}

export function importTags() {
  return getSqlite()
    .prepare("SELECT import_tag AS tag, COUNT(*) AS n, MIN(name_len) AS lmin, MAX(name_len) AS lmax FROM pool WHERE import_tag IS NOT NULL GROUP BY import_tag ORDER BY import_tag DESC")
    .all() as Array<{ tag: string; n: number; lmin: number; lmax: number }>;
}
