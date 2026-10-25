import type { Metadata } from "next";
import Link from "next/link";
import { one } from "@/lib/format";
import { poolFacets, SET_LABELS } from "@/lib/pool";
import { PoolRoundForm } from "./pool-form";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "ساخت دور" };

const errors: Record<string, string> = {
  title: "برای دور عنوانی تا ۸۰ نویسه بگذارید.",
  file: "یک فایل CSV انتخاب کنید.",
  size: "این فایل بزرگ‌تر از ۲۰ مگابایت است.",
};

export default async function NewRoundPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const code = one(query.error);
  const error = code === "parse" ? one(query.message) || "این فایل خوانده نشد." : errors[code ?? ""];

  const mode = one(query.mode) === "csv" ? "csv" : "pool";
  const facets = mode === "pool" ? poolFacets() : null;
  const tab = (id: string, label: string) => (
    <Link
      href={`/admin/rounds/new?mode=${id}`}
      className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold ${mode === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl">ساخت دور رأی‌گیری</h1>
      <div className="mt-6 flex gap-1 border-b border-line">
        {tab("pool", "از استخر فروشی")}
        {tab("csv", "بارگذاری CSV (قدیمی)")}
        <Link href="/admin/rounds/batch" className="px-4 py-2 text-sm text-muted hover:text-ink">چند دور با هم ←</Link>
      </div>
      {facets ? (
        <PoolRoundForm
          classes={facets.classes}
          providers={facets.providers}
          total={facets.totals.total}
          setCounts={[1, 2, 3, 4, 5].map((n) => ({ n, label: SET_LABELS[n], count: Number(facets.totals[`s${n}` as "s1"] ?? 0) }))}
          error={error}
        />
      ) : (
        <>
          <p className="mt-6 max-w-xl text-muted">
            یک فایل بارگذاری کنید، ستون دامنه، قیمت و پریمیوم را مشخص کنید و دور را باز کنید. نام‌های خالی رد می‌شوند.
            اگر دامنه‌ای تکرار شده باشد، ردیف اول نگه داشته می‌شود.
          </p>
          <UploadForm error={error} />
        </>
      )}
    </main>
  );
}
