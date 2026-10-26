"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { applySupplement, removeSupplement } from "@/lib/supplements";

export async function applySupplementAction(formData: FormData) {
  const admin = await requireAdmin();
  const tag = String(formData.get("tag") ?? "").trim();
  if (!tag) redirect("/admin/pool/supplement");
  const match = formData.get("match") === "length" ? "length" : "filters";
  const res = applySupplement(tag, admin.userId, undefined, match);
  revalidatePath("/admin");
  redirect(`/admin/pool/supplement?tag=${encodeURIComponent(tag)}&match=${match}&applied=${res.names}&rounds=${res.rounds}`);
}

export async function removeSupplementAction(formData: FormData) {
  await requireAdmin();
  const tag = String(formData.get("tag") ?? "").trim();
  const removed = tag ? removeSupplement(tag) : 0;
  revalidatePath("/admin");
  redirect(`/admin/pool/supplement?tag=${encodeURIComponent(tag)}&removed=${removed}`);
}
