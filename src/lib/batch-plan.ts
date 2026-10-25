export type BatchPlan = {
  total: number; // names in the block after filters and cap
  rounds: number;
  perRound: number;
  remainderMode: "extra" | "last" | "drop";
};

/** Pure split maths shared by the live calculator and the server. */
export function planBatch(plan: BatchPlan) {
  const total = Math.max(0, Math.floor(plan.total));
  const per = Math.max(1, Math.floor(plan.perRound));
  const rounds = Math.max(1, Math.floor(plan.rounds));
  const used = Math.min(total, rounds * per);
  const remainder = total - used;
  const sizes: number[] = [];
  for (let i = 0; i < rounds && i * per < total; i++) sizes.push(Math.min(per, total - i * per));
  if (remainder > 0 && plan.remainderMode === "extra") {
    for (let left = remainder; left > 0; left -= per) sizes.push(Math.min(per, left));
  }
  if (remainder > 0 && plan.remainderMode === "last" && sizes.length) sizes[sizes.length - 1] += remainder;
  return { total, used, remainder, sizes, placed: sizes.reduce((a, b) => a + b, 0) };
}
