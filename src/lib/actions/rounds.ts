"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { parseDomainCsv } from "@/lib/csv";
import { normalizeFilters } from "@/lib/filters";
import { closeRound, createRound, getRound, countMatching, deriveRound } from "@/lib/rounds";

function optionalNumberInput(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export async function createRoundAction(formData: FormData) {
  await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 80) redirect("/admin/rounds/new?mode=csv&error=title");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/admin/rounds/new?mode=csv&error=file");
  if (file.size > 20 * 1024 * 1024) redirect("/admin/rounds/new?mode=csv&error=size");

  const fromText = String(formData.get("from") ?? "").trim();
  const toText = String(formData.get("to") ?? "").trim();
  const parsed = parseDomainCsv(
    await file.text(),
    {
      domainColumn: String(formData.get("domainColumn") ?? ""),
      priceColumn: String(formData.get("priceColumn") ?? "") || undefined,
      premiumColumn: String(formData.get("premiumColumn") ?? "") || undefined,
    },
    {
      from: fromText ? Number(fromText) : null,
      to: toText ? Number(toText) : null,
    },
  );

  if (parsed.error || parsed.rows.length === 0) {
    redirect(`/admin/rounds/new?mode=csv&error=parse&message=${encodeURIComponent(parsed.error ?? "دامنه‌ای پیدا نشد.")}`);
  }

  const id = createRound({
    title,
    parentRoundId: null,
    filterJson: null,
    sortMode: "original",
    rows: parsed.rows,
  });

  revalidatePath("/admin");
  redirect(
    `/admin/rounds/${id}?imported=${parsed.rows.length}&skippedEmpty=${parsed.skippedEmpty}&skippedDuplicate=${parsed.skippedDuplicate}`,
  );
}

export async function closeRoundAction(formData: FormData) {
  await requireAdmin();
  const roundId = Number(formData.get("roundId"));
  if (!getRound(roundId)) redirect("/admin");
  closeRound(roundId);
  revalidatePath("/admin");
  revalidatePath(`/admin/rounds/${roundId}`);
  revalidatePath(`/vote/${roundId}`);
  redirect(`/admin/rounds/${roundId}?closed=1`);
}

export async function countMatchesAction(
  roundId: number,
  input: {
    minVotes: string;
    maxVotes: string;
    premium: string;
    minPrice: string;
    maxPrice: string;
    sort: string;
  },
) {
  const session = await getSession();
  if (!session || session.role !== "admin") return { count: 0, error: "برای پیش‌نمایش با حساب مدیر وارد شوید." };
  if (!getRound(roundId)) return { count: 0, error: "این دور دیگر وجود ندارد." };
  const { filters, error } = normalizeFilters(input);
  if (error) return { count: 0, error };
  return { count: countMatching(roundId, filters) };
}

export async function deriveRoundAction(formData: FormData) {
  await requireAdmin();
  const roundId = Number(formData.get("roundId"));
  const parent = getRound(roundId);
  if (!parent) redirect("/admin");

  const title = String(formData.get("title") ?? "").trim();
  const back = `/admin/rounds/${roundId}?tab=next`;
  if (!title || title.length > 80) {
    redirect(`${back}&error=${encodeURIComponent("برای دور بعد عنوانی تا ۸۰ نویسه بگذارید.")}`);
  }

  const { filters, error } = normalizeFilters({
    minVotes: optionalNumberInput(formData.get("minVotes")),
    maxVotes: optionalNumberInput(formData.get("maxVotes")),
    premium: formData.get("premium"),
    minPrice: optionalNumberInput(formData.get("minPrice")),
    maxPrice: optionalNumberInput(formData.get("maxPrice")),
    sort: formData.get("sort"),
  });
  if (error) redirect(`${back}&error=${encodeURIComponent(error)}`);

  if (countMatching(roundId, filters) === 0) {
    redirect(`${back}&error=${encodeURIComponent("هیچ دامنه‌ای با این فیلترها جور نیست.")}`);
  }
  const { id } = deriveRound({ title, parentRoundId: roundId, filters });

  revalidatePath("/admin");
  redirect(`/admin/rounds/${id}?derived=1`);
}
