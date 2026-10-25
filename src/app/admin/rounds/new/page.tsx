import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { ACTIVE_SETS } from "@/lib/sets";
import Link from "next/link";
import { one } from "@/lib/format";
import { poolFacets, SET_LABELS } from "@/lib/pool";
import { listAssignableUsers } from "@/lib/assignees";
import { PoolRoundForm } from "./pool-form";
import { ExploreRoundForm } from "./explore-form";
import { browseToParams, countBrowse, parseBrowse } from "@/lib/pool-browse";
import { withParams } from "@/lib/format";
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

  const rawMode = one(query.mode);
  const mode = rawMode === "csv" ? "csv" : rawMode === "explore" ? "explore" : "pool";
  const browse = mode === "explore" ? parseBrowse(query) : null;
  const explore = browse ? withParams("", browseToParams(browse)).replace(/^\?/, "") : "";
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
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{t.newRound.title}</h1>
      <div className="mt-6 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-line">
        {tab("pool", t.newRound.tabPool)}
        {tab("csv", t.newRound.tabCsv)}
        <Link href="/admin/rounds/batch" className="px-4 py-2 text-sm text-muted hover:text-ink">{t.newRoundUx.batchLink}</Link>
      </div>
      {browse ? (
        <ExploreRoundForm explore={explore} count={countBrowse(browse)} users={listAssignableUsers()} error={error} />
      ) : facets ? (
        <PoolRoundForm
          users={listAssignableUsers()}
          classes={facets.classes}
          providers={facets.providers}
          total={facets.totals.total}
          setCounts={ACTIVE_SETS.map((n) => ({ n, label: SET_LABELS[n], count: Number(facets.totals[`s${n}` as "s1"] ?? 0) }))}
          error={error}
        />
      ) : (
        <>
          <UploadForm error={error} />
        </>
      )}
    </main>
  );
}
