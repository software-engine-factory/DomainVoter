import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { AssigneeChips } from "@/components/admin/assignee-picker";
import { assigneesByRound } from "@/lib/assignees";
import { Badge, ProgressBar, buttonClass } from "@/components/ui";
import { formatPercent, formatWhen } from "@/lib/format";
import { listRounds } from "@/lib/rounds";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.common.rounds };

export default async function AdminHomePage() {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const rounds = listRounds();
  const assigned = assigneesByRound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">{t.admin.roundsTitle}</h1>
          <p className="mt-3 text-muted">{t.admin.coverageLead}</p>
        </div>
        <Link href="/admin/rounds/new" className={buttonClass()}>
          {t.admin.createRound}
        </Link>
      </div>

      {rounds.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <h2 className="font-display text-3xl">{t.admin.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{t.admin.emptyBody}</p>
          <Link href="/admin/rounds/new" className={`${buttonClass()} mt-6`}>
            {t.admin.createRound}
          </Link>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {rounds.map((round) => {
            const percent = formatPercent(round.viewedCount, round.domainCount);
            return (
              <li key={round.id}>
                <Link
                  href={`/admin/rounds/${round.id}`}
                  className="grid gap-4 px-5 py-5 transition hover:bg-paper sm:grid-cols-[1fr_16rem]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-3xl">{round.title}</h2>
                      <Badge tone={round.status === "open" ? "accent" : "muted"}>{round.status === "open" ? t.common.open : t.common.closed}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {round.domainCount} {t.common.domains} · {formatWhen(round.createdAt)}
                    </p>
                    {round.parentTitle ? <p className="mt-1 text-sm text-muted">{t.common.fromParent(round.parentTitle)}</p> : null}
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted" data-testid="round-assignees">
                      <span>{t.assignees.column}:</span>
                      <AssigneeChips names={(assigned.get(round.id) ?? []).map((u) => u.username)} />
                    </p>
                  </div>
                  <div className="flex flex-col justify-center">
                    <ProgressBar value={percent} label={t.admin.seenLabel} />
                    <p className="mt-2 text-xs text-muted">
                      {t.admin.seenCount(round.viewedCount, round.domainCount)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
