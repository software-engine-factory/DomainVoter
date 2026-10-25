import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { listBatches } from "@/lib/batches";
import { formatWhen, one } from "@/lib/format";
import { SET_LABELS, poolFacets } from "@/lib/pool";
import { BatchForm } from "./batch-form";

export const metadata: Metadata = { title: "ساخت دسته‌ای دور" };

export default async function BatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const error = one((await searchParams).error);
  const facets = poolFacets();
  const batches = listBatches();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">ساخت دسته‌ای دور</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">یک بلوک از استخر بردارید، ترتیبش را تعیین کنید و آن را به چند دور تقسیم کنید؛ همه را یک‌جا بسازید یا یکی‌یکی.</p>
      {error ? <div className="mt-3"><Alert tone="danger">{error}</Alert></div> : null}
      <BatchForm classes={facets.classes} providers={facets.providers} setLabels={SET_LABELS} poolTotal={facets.totals.total} />
      {batches.length ? (
        <section className="mt-8">
          <h2 className="font-semibold">دسته‌های قبلی</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <Link href={`/admin/rounds/batch/${b.id}`} className="font-semibold underline underline-offset-4">{b.title}</Link>
                <span className="text-xs text-muted">{b.blockTotal} نام · {b.roundsCreated} دور ساخته شده · {formatWhen(b.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
