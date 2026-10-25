import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { one } from "@/lib/format";
import { poolFacets, SET_LABELS } from "@/lib/pool";
import { listAssignableUsers } from "@/lib/assignees";
import { PoolRoundForm } from "./pool-form";
import { UploadForm } from "./upload-form";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.admin.createRound };

const errors: Record<string, string> = {
  title: t.newRound.err.title,
  file: t.newRound.err.file,
  size: t.newRound.err.size,
};

export default async function NewRoundPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const query = await searchParams;
  const code = one(query.error);
  const error = code === "parse" ? one(query.message) || t.newRound.err.unreadable : errors[code ?? ""];

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
      <h1 className="font-display text-4xl">{t.newRound.title}</h1>
      <div className="mt-6 flex gap-1 border-b border-line">
        {tab("pool", t.newRound.tabPool)}
        {tab("csv", t.newRound.tabCsv)}
        <Link href="/admin/rounds/batch" className="px-4 py-2 text-sm text-muted hover:text-ink">{t.newRoundUx.batchLink}</Link>
      </div>
      {facets ? (
        <PoolRoundForm
          users={listAssignableUsers()}
          classes={facets.classes}
          providers={facets.providers}
          total={facets.totals.total}
          setCounts={[1, 2, 3, 4, 5].map((n) => ({ n, label: SET_LABELS[n], count: Number(facets.totals[`s${n}` as "s1"] ?? 0) }))}
          error={error}
        />
      ) : (
        <>
          <p className="mt-6 max-w-xl text-muted">
            {t.newRound.csvLead1}
            {t.newRound.csvLead2}
          </p>
          <UploadForm error={error} />
        </>
      )}
    </main>
  );
}
