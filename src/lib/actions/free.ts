"use server";

import fs from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { importFreeCsv } from "@/lib/free-names";
import { dataDir } from "@/lib/paths";
import { t } from "@/lib/copy/fa";

export async function uploadFreeAction(formData: FormData) {
  await requireAdmin();
  const upload = formData.get("file");
  if (!(upload instanceof File) || upload.size === 0) redirect(`/admin/free?error=${encodeURIComponent(t.pool.err.pick)}`);
  if (path.extname(upload.name).toLowerCase() !== ".csv") redirect(`/admin/free?error=${encodeURIComponent(t.pool.err.type)}`);
  const tag = String(formData.get("tag") ?? "").trim().slice(0, 80) || null;
  const dir = path.join(dataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `free-${Date.now()}.csv`);
  fs.writeFileSync(target, Buffer.from(await upload.arrayBuffer()));
  const res = await importFreeCsv(target, tag);
  revalidatePath("/admin/free");
  if (res.error) redirect(`/admin/free?error=${encodeURIComponent(res.error)}`);
  redirect(`/admin/free?imported=${res.upserted}&skipped=${res.skipped}`);
}
