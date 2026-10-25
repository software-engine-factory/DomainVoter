"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setVotePageSize } from "@/lib/settings";

export async function saveVotePageSizeAction(formData: FormData) {
  const session = await requireAdmin();
  const size = Number(formData.get("size"));
  try {
    setVotePageSize(size, session.userId);
  } catch {
    return;
  }
  revalidatePath("/admin/settings");
  revalidatePath("/vote", "layout");
}
