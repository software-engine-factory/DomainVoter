import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { AssigneeChips } from "@/components/admin/assignee-picker";
import { assigneesByRound } from "@/lib/assignees";
import { Badge, ProgressBar, buttonClass } from "@/components/ui";
import { formatPercent, formatWhen } from "@/lib/format";
import { listRounds } from "@/lib/rounds";
import { DeleteRoundButton } from "@/components/admin/delete-round";
import { RoundTitle } from "@/components/admin/round-title";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.common.rounds };

export default async function AdminHomePage() {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const rounds = listRounds();
  const assigned = assigneesByRound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl sm:text-5xl">{t.admin.roundsTitle}</h1>
        <Link href="/admin/rounds/new" className={buttonClass()}>
          {t.admin.createRound}
        </Link>
      </div>

      {rounds.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <h2 className="font-display text-3xl">{t.admin.emptyTitle}</h2>
          <Link href="/admin/rounds/new" className={`${buttonClass()} mt-6`}>
            {t.admin.createRound}
          </Link>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {rounds.map((round) => {
            const percent = formatPercent(round.viewedCount, round.domainCount);
            return (
              <li key={round.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_14rem] sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <RoundTitle id={round.id} title={round.title} className="font-display text-2xl sm:text-3xl" />
                    {round.lenMin != null ? (
                      <span title={round.lenMin === round.lenMax ? t.len.roundLength(round.lenMin) : t.len.mixed} data-testid="round-length">
                        <Badge tone="muted">{round.lenMin === round.lenMax ? t.len.letters(round.lenMin) : t.len.mixed}</Badge>
                      </span>
                    ) : null}
                    <Badge tone={round.status === "open" ? "accent" : "muted"}>{round.status === "open" ? t.common.open : t.common.closed}</Badge>
                    <span className="ms-auto sm:ms-0"><DeleteRoundButton id={round.id} title={round.title} /></span>
                  </div>
                  <Link href={`/admin/rounds/${round.id}`} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted hover:text-ink">
                    <span>
                      {round.domainCount.toLocaleString("fa-IR")} {t.common.domains} · {formatWhen(round.createdAt)}
                    </span>
                    {round.parentTitle ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-xs" title={t.common.fromParent(round.parentTitle)}>
                        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                          <path d="M11 3v4a3 3 0 0 1-3 3H3m0 0l3-3m-3 3l3 3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {round.parentTitle}
                      </span>
                    ) : null}
                  </Link>
                  {(assigned.get(round.id) ?? []).length ? (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted" data-testid="round-assignees">
                      <AssigneeChips names={(assigned.get(round.id) ?? []).map((u) => u.username)} />
                    </p>
                  ) : null}
                </div>
                <Link href={`/admin/rounds/${round.id}`} className="flex flex-col justify-center" title={t.admin.seenCount(round.viewedCount, round.domainCount)}>
                  <ProgressBar value={percent} label={t.admin.seenLabel} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
