import { getSqlite } from "@/db";
import { poolWhere, type PoolFilters } from "@/lib/pool";

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

function ensureFunctions() {
  getSqlite().function("dv_seeded_rank", { deterministic: true }, (seed: unknown, name: unknown) => seededRank(String(seed), String(name)));
}

function orderSql(order: BatchOrder) {
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
      return "p.set_1 DESC, p.set_2 DESC, p.set_3 DESC, p.set_4 DESC, p.set_5 DESC, p.name";
    default:
      return "dv_seeded_rank(?, p.name), p.name";
  }
}

export function countBlock(filters: PoolFilters, cap: number | null, excludeUsed: boolean) {
  const where = blockWhere(filters, excludeUsed);
  const n = (getSqlite().prepare(`SELECT COUNT(*) AS n FROM pool p ${where.sql}`).get(...where.params) as { n: number }).n;
  return cap != null && cap > 0 ? Math.min(cap, n) : n;
}

function blockWhere(filters: PoolFilters, excludeUsed: boolean) {
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
};

/** Freezes the ordered block, then opens the first `createNow` rounds from it. */
export function createBatch(input: BatchInput) {
  ensureFunctions();
  const sqlite = getSqlite();
  const where = blockWhere(input.filters, input.excludeUsed);
  const order = orderSql(input.order);
  const orderParams = input.order === "random" ? [input.seed] : [];
  return sqlite.transaction(() => {
    const now = Date.now();
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
        now,
        input.adminId,
      );
    const batchId = Number(info.lastInsertRowid);
    const limit = input.cap != null && input.cap > 0 ? "LIMIT ?" : "";
    const inserted = sqlite
      .prepare(
        `INSERT INTO round_batch_items (batch_id, position, name)
         SELECT ?, ROW_NUMBER() OVER (ORDER BY ${order}), name FROM (
           SELECT p.name, p.price_usd, p.dns_ns_class, p.dns_parking_provider, p.set_1, p.set_2, p.set_3, p.set_4, p.set_5
           FROM pool p ${where.sql} ORDER BY ${order} ${limit}
         ) p`,
      )
      .run(batchId, ...orderParams, ...where.params, ...orderParams, ...(limit ? [input.cap] : []));
    const total = inserted.changes;
    if (total === 0) {
      sqlite.prepare("DELETE FROM round_batches WHERE id = ?").run(batchId);
      return { batchId: 0, total: 0, created: [] as number[] };
    }
    sqlite.prepare("UPDATE round_batches SET block_total = ? WHERE id = ?").run(total, batchId);
    const plan = planBatch({ ...input.plan, total });
    const howMany = input.createNow > 0 ? Math.min(input.createNow, plan.sizes.length) : plan.sizes.length;
    const created: number[] = [];
    for (let i = 0; i < howMany; i++) created.push(openBatchRound(batchId).roundId);
    return { batchId, total, created };
  })();
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
  return getSqlite().prepare(`${BATCH_SELECT} WHERE b.id = ?`).get(id) as BatchRow | undefined;
}

export function listBatches() {
  return getSqlite().prepare(`${BATCH_SELECT} ORDER BY b.id DESC`).all() as BatchRow[];
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
