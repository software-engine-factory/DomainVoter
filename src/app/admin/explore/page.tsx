import type { Metadata } from "next";
import Link from "next/link";
import { InfoTip } from "@/components/admin/info-tip";
import { requireAdmin } from "@/lib/auth";
import { one } from "@/lib/format";
import { t } from "@/lib/copy/fa";
import { ActivityView } from "./activity-view";
import { NamesView } from "./names-view";

export const metadata: Metadata = { title: t.explore.title };

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const query = await searchParams;
  const mode = one(query.mode) === "activity" ? "activity" : "names";
  const tab = (on: boolean) =>
    `inline-flex h-8 items-center rounded-md px-3 text-sm font-semibold transition ${on ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`;
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-3xl sm:text-4xl">
          {mode === "activity" ? t.explore.title : t.browse.title}
          <InfoTip>{mode === "names" ? t.browse.tip : t.explore.lead}</InfoTip>
        </h1>
        <nav className="inline-flex rounded-lg bg-paper p-1 ring-1 ring-line">
          <Link href="/admin/explore" className={tab(mode === "names")} aria-current={mode === "names" ? "page" : undefined}>{t.browse.tabNames}</Link>
          <Link href="/admin/explore?mode=activity" className={tab(mode === "activity")} aria-current={mode === "activity" ? "page" : undefined}>{t.browse.tabActivity}</Link>
        </nav>
      </div>
      {mode === "names" ? <NamesView query={query} /> : <ActivityView query={query} />}
    </main>
  );
}
