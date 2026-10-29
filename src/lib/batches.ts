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
  const n = (await reader().get<{ n: number }>(`SELECT COUNT(*) AS n FROM pool p ${where.sql}`, where.params))!.n;
  return cap != null && cap > 0 ? Math.min(cap, n) : n;
}

export function blockWhere(filters: PoolFilters, excludeUsed: boolean) {
  const where = poolWhere(filters);
  if (!excludeUsed) return where;
  const extra = "p.name NOT IN (SELECT pool_name FROM domains WHERE pool_name IS NOT NULL)";
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
  const index = batch.roundsCreated; // 0-based
  if (index >= plan.sizes.length) return { roundId: 0, count: 0 };
  const start = plan.sizes.slice(0, index).reduce((a, b) => a + b, 0);
  const size = plan.sizes[index];
  return sqlite.transaction(() => {
    const now = Date.now();
    const title = `${batch.title} · ${index + 1}/${plan.sizes.length}`;
    const info = sqlite
      .prepare(
        `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source, batch_id, batch_index)
         VALUES (?, 'open', NULL, ?, ?, ?, ?, 'pool', ?, ?)`,
      )
      .run(title, batch.filterJson, batch.orderMode, now, now, batchId, index + 1);
    const roundId = Number(info.lastInsertRowid);
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
              (SELECT COUNT(*) FROM domains d WHERE d.round_id = r.id) AS size,
              (SELECT COUNT(DISTINCT domain_id) FROM views v WHERE v.round_id = r.id) AS viewed,
              (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id) AS votes
       FROM rounds r WHERE r.batch_id = ? ORDER BY r.batch_index`,
    )
    .all(batchId) as Array<{ id: number; title: string; status: string; batchIndex: number; size: number; viewed: number; votes: number }>;
}
