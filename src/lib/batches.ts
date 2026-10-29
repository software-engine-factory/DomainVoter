import { copyBatchAssignees, setBatchAssignees } from "@/lib/assignees";
import { getSqlite } from "@/db";
import { poolWhere, type PoolFilters } from "@/lib/pool";
import { orderedNames, writeChunks } from "@/lib/bulk-fill";
import { reader } from "@/lib/ro";

export const BATCH_ORDERS = ["random", "name", "price_asc", "price_desc", "provider", "set"] as const;
export type BatchOrder = (typeof BATCH_ORDERS)[number];

import { planBatch, type BatchPlan } from "@/lib/batch-plan";

export { planBatch, type BatchPlan };

/** FNV-1a over seed + name: same seed, same shuffle, on any machine. */
function seededRank(seed: string, name: string) {
  let h = 0x811c9dc5;
  const text = `${seed}:${name}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function ensureFunctions() {
  getSqlite().function("dv_seeded_rank", { deterministic: true }, (seed: unknown, name: unknown) => seededRank(String(seed), String(name)));
}

export function orderSql(order: BatchOrder) {
  switch (order) {
    case "name":
      return "p.name ASC";
    case "price_asc":
      return "p.price_usd IS NULL, p.price_usd ASC, p.name";
    case "price_desc":
      return "p.price_usd IS NULL, p.price_usd DESC, p.name";
    case "provider":
      return "p.dns_ns_class IS NULL, p.dns_ns_class, p.dns_parking_provider IS NULL, p.dns_parking_provider, p.name";
    case "set":
      return "p.set_1 DESC, p.set_3 DESC, p.set_4 DESC, p.set_5 DESC, p.name";
    default:
      return "dv_seeded_rank(?, p.name), p.name";
  }
}

/** Live block size; runs in a reader thread (with free names a count can scan ~2M rows). */
export async function countBlock(filters: PoolFilters, cap: number | null, excludeUsed: boolean) {
  const where = blockWhere(filters, excludeUsed);
  // A capped batch only needs to know whether the selection reaches the cap. Stop the
  // scan as soon as that many matches have been found instead of counting the whole pool.
  if (cap != null && cap > 0) {
    return (await reader().get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM pool p ${where.sql} LIMIT ?)`,
      [...where.params, cap],
    ))!.n;
  }
  return (await reader().get<{ n: number }>(`SELECT COUNT(*) AS n FROM pool p ${where.sql}`, where.params))!.n;
}

export function blockWhere(filters: PoolFilters, excludeUsed: boolean) {
  const where = poolWhere(filters);
  if (!excludeUsed) return where;
  const extra = "p.name NOT IN (SELECT pool_name FROM domain_catalog WHERE pool_name IS NOT NULL)";
  return { sql: where.sql ? `${where.sql} AND ${extra}` : `WHERE ${extra}`, params: where.params };
}

export type BatchInput = {
  title: string;
  filters: PoolFilters;
  order: BatchOrder;
  seed: string;
  cap: number | null;
  excludeUsed: boolean;
  plan: Omit<BatchPlan, "total">;
  createNow: number; // how many rounds to open immediately (0 = all)
  adminId: number;
  assignees?: number[];
};

/**
 * Freezes the ordered block, then opens the first `createNow` rounds from it. The order is computed in
 * a reader thread and the block is written in short chunks (lib/bulk-fill), so voters are never held up.
 */
export async function createBatch(input: BatchInput) {
  ensureFunctions();
  const sqlite = getSqlite();
  const where = blockWhere(input.filters, input.excludeUsed);
  const order = orderSql(input.order);
  const orderParams = input.order === "random" ? [input.seed] : [];
  const capped = input.cap != null && input.cap > 0;
  const inner = `SELECT p.name, p.price_usd, p.dns_ns_class, p.dns_parking_provider, p.set_1, p.set_2, p.set_3, p.set_4, p.set_5
                 FROM pool p ${where.sql} ${capped ? `ORDER BY ${order} LIMIT ?` : ""}`;
  const names = await orderedNames(`SELECT p.name AS name, ROW_NUMBER() OVER (ORDER BY ${order}) AS rn FROM (${inner}) p`, [
    ...orderParams,
    ...where.params,
    ...(capped ? [...orderParams, input.cap] : []),
  ]);
  if (!names) return { batchId: 0, total: 0, created: [] as number[] };
  const info = sqlite
    .prepare(
      `INSERT INTO round_batches (title, filter_json, order_mode, seed, block_total, per_round, rounds_planned, remainder_mode, created_at, created_by)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      JSON.stringify({ ...input.filters, cap: input.cap, excludeUsed: input.excludeUsed }),
      input.order,
      input.order === "random" ? input.seed : null,
      input.plan.perRound,
      input.plan.rounds,
      input.plan.remainderMode,
      Date.now(),
      input.adminId,
    );
  const batchId = Number(info.lastInsertRowid);
  let total = 0;
  try {
    const insert = sqlite.prepare("INSERT INTO round_batch_items (batch_id, position, name) SELECT ?, ? + j.key + 1, j.value FROM json_each(?) j");
    total = await writeChunks(names, (json, offset) => insert.run(batchId, offset, json).changes);
  } catch (error) {
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM round_batch_items WHERE batch_id = ?").run(batchId);
      sqlite.prepare("DELETE FROM round_batches WHERE id = ?").run(batchId);
    })();
    throw error;
  }
  sqlite.prepare("UPDATE round_batches SET block_total = ? WHERE id = ?").run(total, batchId);
  setBatchAssignees(batchId, input.assignees ?? []);
  const plan = planBatch({ ...input.plan, total });
  const howMany = input.createNow > 0 ? Math.min(input.createNow, plan.sizes.length) : plan.sizes.length;
  const created: number[] = [];
  for (let i = 0; i < howMany; i++) {
    created.push(openBatchRound(batchId).roundId);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { batchId, total, created };
}

/** Opens the next round of a batch from the frozen block. Returns roundId 0 when the block is used up. */
export function openBatchRound(batchId: number) {
  const sqlite = getSqlite();
  const batch = getBatch(batchId);
  if (!batch) return { roundId: 0, count: 0 };
  const plan = planBatch({ total: batch.blockTotal, rounds: batch.roundsPlanned, perRound: batch.perRound, remainderMode: batch.remainderMode });
  const opened = new Set((sqlite.prepare("SELECT batch_index AS n FROM rounds WHERE batch_id=?").all(batchId) as {n:number}[]).map(row=>row.n));
  const index = plan.sizes.findIndex((_,i)=>!opened.has(i+1));
  if (index < 0) return { roundId: 0, count: 0 };
  const start = plan.sizes.slice(0, index).reduce((a, b) => a + b, 0);
  const size = plan.sizes[index];
  return sqlite.transaction(() => {
    if (sqlite.prepare("SELECT 1 FROM creation_jobs WHERE state IN ('queued','running','cancelling')").get()) throw new Error("capacity");
    const now = Date.now();
    const title = `${batch.title} · ${index + 1}/${plan.sizes.length}`;
    const info = sqlite
      .prepare(
        `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source, batch_id, batch_index)
         VALUES (?, 'open', NULL, ?, ?, ?, ?, 'pool', ?, ?)`,
      )
      .run(title, batch.filterJson, batch.orderMode, now, now, batchId, index + 1);
    const roundId = Number(info.lastInsertRowid);
    const selection = sqlite.prepare("SELECT id FROM domain_selections WHERE batch_id=?").get(batchId) as { id: number } | undefined;
    if (selection) {
      // Reserve fresh IDs when opening a range, including after a deleted round. Stale voter pages must never target a new round.
      const high = (sqlite.prepare("SELECT COALESCE(MAX(id),0) AS n FROM selection_items").get() as {n:number}).n;
      sqlite.prepare("UPDATE selection_items SET id=id+? WHERE selection_id=? AND position>? AND position<=?")
        .run(high,selection.id,start,start+size);
      // UPDATE does not advance SQLite's AUTOINCREMENT high-water mark. Retain it even after this selection is deleted.
      sqlite.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,(SELECT MAX(id) FROM selection_items)) WHERE name='selection_items'").run();
      // Later rounds retain their historical contract: price is captured when opened, not when the batch was frozen.
      const changed = sqlite.prepare(`UPDATE selection_items SET (price,currency)=
        (SELECT COALESCE(p.lp_price,p.best_price),p.lp_currency FROM pool p WHERE p.name=selection_items.name)
        WHERE selection_id=? AND position>? AND position<=?
        AND EXISTS(SELECT 1 FROM pool p WHERE p.name=selection_items.name)`)
        .run(selection.id,start,start+size).changes;
      if (changed !== size) throw new Error("source_changed");
      const stats = sqlite.prepare(`SELECT MIN(instr(name||'.','.')-1) AS lo, MAX(instr(name||'.','.')-1) AS hi
        FROM selection_items WHERE selection_id=? AND position>? AND position<=?`).get(selection.id,start,start+size) as {lo:number;hi:number};
      const mode = stats.lo === stats.hi ? stats.lo : (sqlite.prepare(`SELECT instr(name||'.','.')-1 AS len FROM selection_items
        WHERE selection_id=? AND position>? AND position<=? GROUP BY len ORDER BY COUNT(*) DESC,len LIMIT 1`)
        .get(selection.id,start,start+size) as {len:number}).len;
      sqlite.prepare("INSERT INTO round_domain_ranges(round_id,selection_id,start_position,end_position,len_min,len_max,label_length) VALUES (?,?,?,?,?,?,?)")
        .run(roundId,selection.id,start+1,start+size,stats.lo,stats.hi,mode);
      copyBatchAssignees(batchId,roundId);
      return {roundId,count:size};
    }
    const inserted = sqlite
      .prepare(
        `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency)
         SELECT ?, i.position - ?, p.name, COALESCE(p.lp_price, p.best_price), 0, NULL, p.name, p.lp_currency
         FROM round_batch_items i JOIN pool p ON p.name = i.name
         WHERE i.batch_id = ? AND i.position > ? AND i.position <= ?
         ORDER BY i.position`,
      )
      .run(roundId, start, batchId, start, start + size);
    copyBatchAssignees(batchId, roundId);
    return { roundId, count: inserted.changes };
  })();
}

export type BatchRow = {
  id: number;
  title: string;
  filterJson: string;
  orderMode: BatchOrder;
  seed: string | null;
  blockTotal: number;
  perRound: number;
  roundsPlanned: number;
  remainderMode: "extra" | "last" | "drop";
  createdAt: number;
  roundsCreated: number;
};

const BATCH_SELECT = `SELECT b.id, b.title, b.filter_json AS filterJson, b.order_mode AS orderMode, b.seed, b.block_total AS blockTotal,
  b.per_round AS perRound, b.rounds_planned AS roundsPlanned, b.remainder_mode AS remainderMode, b.created_at AS createdAt,
  (SELECT COUNT(*) FROM rounds r WHERE r.batch_id = b.id) AS roundsCreated
  FROM round_batches b`;

export function getBatch(id: number) {
  if (!Number.isInteger(id)) return undefined;
  return getSqlite().prepare(`${BATCH_SELECT} WHERE b.id = ? AND b.creation_job_id IS NULL`).get(id) as BatchRow | undefined;
}

export function listBatches() {
  return getSqlite().prepare(`${BATCH_SELECT} WHERE b.creation_job_id IS NULL ORDER BY b.id DESC`).all() as BatchRow[];
}

export function batchRounds(batchId: number) {
  return getSqlite()
    .prepare(
      `SELECT r.id, r.title, r.status, r.batch_index AS batchIndex,
              COALESCE((SELECT end_position-start_position+1 FROM round_domain_ranges WHERE round_id=r.id),0)
                + (SELECT COUNT(*) FROM domains d WHERE d.round_id=r.id AND (d.id>0 OR NOT EXISTS(SELECT 1 FROM round_domain_ranges WHERE round_id=r.id))) AS size,
              (SELECT COUNT(DISTINCT domain_id) FROM views v WHERE v.round_id = r.id) AS viewed,
              (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id) AS votes
       FROM rounds r WHERE r.batch_id = ? ORDER BY r.batch_index`,
    )
    .all(batchId) as Array<{ id: number; title: string; status: string; batchIndex: number; size: number; viewed: number; votes: number }>;
}
