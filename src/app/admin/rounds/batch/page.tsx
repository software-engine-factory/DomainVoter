import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { listBatches } from "@/lib/batches";
import { formatWhen, one } from "@/lib/format";
import { SET_LABELS, poolFacets } from "@/lib/pool";
import { listAssignableUsers } from "@/lib/assignees";
import { BatchForm } from "./batch-form";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.batch.title };

export default async function BatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const error = one((await searchParams).error);
  const facets = poolFacets();
  const batches = listBatches();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{t.batch.title}</h1>
      {error ? <div className="mt-3"><Alert tone="danger">{error}</Alert></div> : null}
      <BatchForm classes={facets.classes} providers={facets.providers} setLabels={SET_LABELS} poolTotal={facets.totals.total} users={listAssignableUsers()} />
      {batches.length ? (
        <section className="mt-8">
          <h2 className="font-semibold">{t.batch.previous}</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <Link href={`/admin/rounds/batch/${b.id}`} className="font-semibold underline underline-offset-4">{b.title}</Link>
                <span className="text-xs text-muted">{t.batch.summary(b.blockTotal, b.roundsCreated, formatWhen(b.createdAt))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
