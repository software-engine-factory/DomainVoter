"use server";

import fs from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { parseAssigneeIds, setRoundAssignees } from "@/lib/assignees";
import { countPool, normalizePoolFilters } from "@/lib/pool";
import { importFile } from "@/lib/pool-import";
import { dataDir, resolveImportPath } from "@/lib/paths";
import { createRoundFromPool } from "@/lib/rounds";
import { createRoundFromBrowse, parseBrowse } from "@/lib/pool-browse";
import { t } from "@/lib/copy/fa";

function done(result: { rowsUpserted: number; rowsSkipped: number; error?: string }) {
  revalidatePath("/admin/pool");
  revalidatePath("/admin/rounds/new");
  if (result.error) redirect(`/admin/pool?error=${encodeURIComponent(result.error)}`);
  redirect(`/admin/pool?imported=${result.rowsUpserted}&skipped=${result.rowsSkipped}`);
}

export async function syncPoolAction(formData: FormData) {
  await requireAdmin();
  const input = String(formData.get("path") ?? "").trim();
  const file = input ? resolveImportPath(input) : null;
  if (!file) redirect(`/admin/pool?error=${encodeURIComponent(t.pool.err.outside)}`);
  if (!fs.existsSync(file)) redirect(`/admin/pool?error=${encodeURIComponent(t.pool.err.notFound(input))}`);
  done(await importFile(file, input));
}

export async function uploadPoolAction(formData: FormData) {
  await requireAdmin();
  const upload = formData.get("file");
  if (!(upload instanceof File) || upload.size === 0) redirect(`/admin/pool?error=${encodeURIComponent(t.pool.err.pick)}`);
  const ext = path.extname(upload.name).toLowerCase();
  if (![".csv", ".db", ".sqlite", ".sqlite3"].includes(ext)) {
    redirect(`/admin/pool?error=${encodeURIComponent(t.pool.err.type)}`);
  }
  const dir = path.join(dataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `pool-${Date.now()}${ext}`);
  fs.writeFileSync(target, Buffer.from(await upload.arrayBuffer()));
  done(await importFile(target, `upload:${upload.name}`));
}

function filterInput(formData: FormData) {
  return {
    classes: formData.getAll("classes").map(String),
    providers: formData.getAll("providers").map(String),
    sets: formData.getAll("sets").map(String),
    setMode: formData.get("setMode"),
    evidence: formData.get("evidence"),
    minUsd: formData.get("minUsd"),
    maxUsd: formData.get("maxUsd"),
    includeUnpriced: formData.get("includeUnpriced") ? "1" : "0",
    order: formData.get("order"),
    length: formData.get("length"),
    avail: formData.get("avail"),
  };
}

export async function countPoolAction(input: Record<string, unknown>) {
  await requireAdmin();
  const { filters, error } = normalizePoolFilters(input);
  if (error) return { count: 0, error };
  return { count: await countPool(filters) };
}

export async function createPoolRoundAction(formData: FormData) {
  await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const back = "/admin/rounds/new?mode=pool";
  if (!title || title.length > 80) redirect(`${back}&error=title`);
  const { filters, error } = normalizePoolFilters(filterInput(formData));
  if (error) redirect(`${back}&error=parse&message=${encodeURIComponent(error)}`);
  const result = await createRoundFromPool(title, filters, String(formData.get("seed") ?? "").trim().slice(0, 40) || null);
  if (result.count === 0) redirect(`${back}&error=parse&message=${encodeURIComponent(t.pool.err.noMatch)}`);
  setRoundAssignees(result.id, parseAssigneeIds(formData));
  revalidatePath("/admin");
  redirect(`/admin/rounds/${result.id}?imported=${result.count}`);
}

/** Explore filters (as a query string) → new round. */
export async function createExploreRoundAction(formData: FormData) {
  await requireAdmin();
  const explore = String(formData.get("explore") ?? "").slice(0, 4000);
  const back = `/admin/rounds/new?mode=explore&${explore}`;
  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 80) redirect(`${back}&error=title`);
  const params: Record<string, string[]> = {};
  for (const [k, v] of new URLSearchParams(explore)) (params[k] ??= []).push(v);
  const result = await createRoundFromBrowse(title, parseBrowse(params));
  if (result.count === 0) redirect(`${back}&error=parse&message=${encodeURIComponent(t.pool.err.noMatch)}`);
  setRoundAssignees(result.id, parseAssigneeIds(formData));
  revalidatePath("/admin");
  redirect(`/admin/rounds/${result.id}?imported=${result.count}`);
}
