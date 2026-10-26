"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { BATCH_ORDERS, countBlock, createBatch, openBatchRound, type BatchOrder } from "@/lib/batches";
import { parseAssigneeIds } from "@/lib/assignees";
import { normalizePoolFilters } from "@/lib/pool";
import { t } from "@/lib/copy/fa";

function filterInput(input: Record<string, unknown>) {
  return normalizePoolFilters({
    classes: input.classes,
    providers: input.providers,
    sets: input.sets,
    setMode: input.setMode,
    evidence: input.evidence,
    minUsd: input.minUsd,
    maxUsd: input.maxUsd,
    includeUnpriced: input.includeUnpriced,
    length: input.length,
  });
}

function positive(value: unknown) {
  const n = Math.floor(Number(String(value ?? "").trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Live block size for the calculator. Every filter is optional: no filters means the whole pool. */
export async function countBlockAction(input: Record<string, unknown>) {
  await requireAdmin();
  const { filters, error } = filterInput(input);
  if (error) return { count: 0, error };
  return { count: countBlock(filters, positive(input.cap), input.excludeUsed === "1") };
}

export async function createBatchAction(formData: FormData) {
  const session = await requireAdmin();
  const back = "/admin/rounds/batch";
  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 70) redirect(`${back}?error=${encodeURIComponent(t.batch.titleMissing)}`);
  const { filters, error } = filterInput({
    classes: formData.getAll("classes").map(String),
    providers: formData.getAll("providers").map(String),
    sets: formData.getAll("sets").map(String),
    setMode: formData.get("setMode"),
    evidence: formData.get("evidence"),
    minUsd: formData.get("minUsd"),
    maxUsd: formData.get("maxUsd"),
    includeUnpriced: formData.get("includeUnpriced") ? "1" : "0",
    length: formData.get("length"),
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error)}`);
  const order = (BATCH_ORDERS as readonly string[]).includes(String(formData.get("order"))) ? (String(formData.get("order")) as BatchOrder) : "random";
  const rounds = positive(formData.get("rounds")) ?? 1;
  const perRound = positive(formData.get("perRound")) ?? 500;
  const remainder = String(formData.get("remainderMode"));
  const result = createBatch({
    title,
    filters,
    order,
    seed: String(formData.get("seed") ?? "").trim() || String(Date.now()),
    cap: positive(formData.get("cap")),
    excludeUsed: formData.get("excludeUsed") === "1",
    plan: { rounds, perRound, remainderMode: remainder === "last" || remainder === "extra" ? remainder : "drop" },
    createNow: formData.get("createMode") === "first" ? 1 : 0,
    adminId: session.userId,
    assignees: parseAssigneeIds(formData),
  });
  if (!result.batchId) redirect(`${back}?error=${encodeURIComponent(t.batch.noMatch)}`);
  revalidatePath("/admin");
  redirect(`/admin/rounds/batch/${result.batchId}?created=${result.created.length}`);
}

export async function openNextBatchRoundAction(formData: FormData) {
  await requireAdmin();
  const batchId = Number(formData.get("batchId"));
  const count = Math.max(1, Math.min(50, positive(formData.get("count")) ?? 1));
  let opened = 0;
  for (let i = 0; i < count; i++) {
    const result = openBatchRound(batchId);
    if (!result.roundId) break;
    opened++;
  }
  revalidatePath("/admin");
  redirect(`/admin/rounds/batch/${batchId}?created=${opened}`);
}
