import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ProgressBar } from "@/components/ui";
import { formatPercent, formatWhen } from "@/lib/format";
import { requireVoter } from "@/lib/auth";
import { listOpenRounds, userRoundProgress } from "@/lib/rounds";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.vote.listTitle };

export const dynamic = "force-dynamic";

export default async function VoteHomePage() {
  const session = await requireVoter();
  const rounds = listOpenRounds(session.userId);
  const progress = userRoundProgress(session.userId);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-5xl">{t.vote.listTitle}</h1>
      {rounds.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <h2 className="font-display text-3xl">{t.vote.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{t.vote.emptyBody}</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {rounds.map((round) => {
            const mine = progress.get(round.id) ?? { seen: 0, voted: 0 };
            const fa = (n: number) => n.toLocaleString("fa-IR");
            return (
            <li key={round.id}>
              <Link href={`/vote/${round.id}`} className="grid gap-3 px-5 py-5 transition hover:bg-paper sm:grid-cols-[1fr_14rem]" title={t.myProgress.tip(fa(mine.seen), fa(round.domainCount), fa(mine.voted))}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-3xl">{round.title}</h2>
                    <Badge tone="accent">{t.common.open}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {round.domainCount} {t.common.domains} · {t.common.openedAt} {formatWhen(round.createdAt)}
                  </p>
                  {round.parentTitle ? <p className="mt-1 text-sm text-muted">{t.common.fromParent(round.parentTitle)}</p> : null}
                </div>
                <div className="flex flex-col justify-center gap-2">
                  <ProgressBar value={formatPercent(mine.seen, round.domainCount)} label={t.myProgress.seenLabel} />
                  <p className="text-xs text-muted">{t.myProgress.votedCount(fa(mine.voted))}</p>
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
