"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { captureProvenance } from "@/lib/bookmarks";

export async function togglePickAction(formData: FormData) {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  if (!name) return;
  const sqlite = getSqlite();
  const existing = sqlite.prepare("SELECT 1 FROM picks WHERE name = ?").get(name);
  if (existing) {
    sqlite.prepare("DELETE FROM picks WHERE name = ?").run(name);
    sqlite.prepare("DELETE FROM pick_provenance WHERE name = ?").run(name);
  } else {
    sqlite
      .prepare("INSERT INTO picks (name, note, created_at, created_by) VALUES (?, ?, ?, ?)")
      .run(name, String(formData.get("note") ?? "").trim() || null, Date.now(), session.userId);
    captureProvenance(name);
  }
  revalidatePath("/admin/picks");
  revalidatePath("/admin/bookmarks");
  const back = String(formData.get("back") ?? "");
  if (back.startsWith("/admin/")) revalidatePath(back.split("?")[0]);
}

export async function updatePickNoteAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  getSqlite()
    .prepare("UPDATE picks SET note = ? WHERE name = ?")
    .run(String(formData.get("note") ?? "").trim().slice(0, 500) || null, name);
  revalidatePath("/admin/picks");
}
