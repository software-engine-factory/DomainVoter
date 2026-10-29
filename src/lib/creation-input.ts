import { blockWhere, orderSql, BATCH_ORDERS, type BatchOrder } from "@/lib/batches";
import { browseWhere, parseBrowse, orderSql as browseOrder } from "@/lib/pool-browse";
import { normalizePoolFilters, poolWhere, poolOrder } from "@/lib/pool";
import { parseAssigneeIds } from "@/lib/assignees";
import type { CreationInput } from "@/lib/creation-jobs";

function positive(value: FormDataEntryValue | null, fallback: number, max: number) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error("invalid_plan");
  return n;
}

export function creationInput(form: FormData, kind: string): CreationInput {
  if (!["pool", "batch", "explore"].includes(kind)) throw new Error("invalid_kind");
  const title = String(form.get("title") ?? "").trim();
  if (!title || title.length > (kind === "batch" ? 70 : 80)) throw new Error("invalid_title");
  const seed = String(form.get("seed") ?? "").trim().slice(0, 40) || "preview";
  const base = { title, seed, assignees: parseAssigneeIds(form), createFirst: form.get("createMode") === "first" };
  const singlePlan = { rounds: 1, perRound: 3_000_000, remainderMode: "drop" as const };
  if (kind === "explore") {
    const params: Record<string, string[]> = {};
    const explore = String(form.get("explore") ?? "");
    if (explore.length > 4000) throw new Error("invalid_filters");
    for (const [k, v] of new URLSearchParams(explore)) (params[k] ??= []).push(v);
    const q = parseBrowse(params); const w = browseWhere(q); const o = browseOrder(q);
    return { ...base, kind, selectionSql: `SELECT p.name FROM pool p ${w.sql} ORDER BY ${o.sql} LIMIT 3000001`, params: [...w.params, ...o.params], filterJson: JSON.stringify({ explore: params }), order: q.sort, plan: singlePlan };
  }
  const raw: Record<string, unknown> = Object.fromEntries(form);
  for (const k of ["classes", "providers", "sets"]) raw[k] = form.getAll(k).map(String);
  raw.includeUnpriced = form.has("includeUnpriced") ? "1" : "0";
  const { filters, error } = normalizePoolFilters(raw);
  if (error) throw new Error("invalid_filters");
  if (kind === "pool") {
    const w = poolWhere(filters);
    const random = filters.order === "random";
    const order = random ? "dv_seeded_rank(?,p.name),p.name" : poolOrder(filters.order);
    return { ...base, kind, selectionSql: `SELECT p.name FROM pool p ${w.sql} ORDER BY ${order} LIMIT 3000001`, params: [...w.params, ...(random ? [seed] : [])], filterJson: JSON.stringify({ ...filters, seed }), order: filters.order, plan: singlePlan };
  }
  const order = String(form.get("order")) as BatchOrder;
  if (!(BATCH_ORDERS as readonly string[]).includes(order)) throw new Error("invalid_order");
  const cap = positive(form.get("cap"), 3_000_000, 3_000_000);
  const w = blockWhere(filters, form.get("excludeUsed") === "1");
  const mode = String(form.get("remainderMode"));
  const plan: CreationInput["plan"] = { rounds: positive(form.get("rounds"), 5, 2000), perRound: positive(form.get("perRound"), 500, 3_000_000), remainderMode: mode === "extra" || mode === "last" ? mode : "drop" };
  return { ...base, kind: "batch", selectionSql: `SELECT p.name FROM pool p ${w.sql} ORDER BY ${orderSql(order)} LIMIT ?`,
    params: [...w.params, ...(order === "random" ? [seed] : []), cap], filterJson: JSON.stringify({ ...filters, cap, excludeUsed: form.get("excludeUsed") === "1" }), order, plan };
}
