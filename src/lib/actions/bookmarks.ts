"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { addBookmark, isBookmarked, removeBookmark, updateBookmark } from "@/lib/bookmarks";

function refresh(back: string) {
  revalidatePath("/admin/picks");
  revalidatePath("/admin/bookmarks");
  if (back.startsWith("/admin/")) revalidatePath(back.split("?")[0]);
}

/** Admin-private bookmark of a name taken from a voter's choices. The voter is never told. */
export async function toggleBookmarkAction(formData: FormData) {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  if (!name) return;
  const source = Number(formData.get("sourceUserId"));
  if (isBookmarked(name)) removeBookmark(name);
  else addBookmark(name, session.userId, Number.isInteger(source) && source > 0 ? source : null, null);
  refresh(String(formData.get("back") ?? ""));
}

export async function updateBookmarkAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  if (!name) return;
  const bonus = String(formData.get("bonusUserId") ?? "");
  updateBookmark(name, {
    status: String(formData.get("status") ?? "") || undefined,
    bonusUserId: bonus === "" ? null : Number.isInteger(Number(bonus)) ? Number(bonus) : null,
    note: formData.has("note") ? String(formData.get("note") ?? "").trim().slice(0, 500) || null : undefined,
  });
  refresh(String(formData.get("back") ?? ""));
}
