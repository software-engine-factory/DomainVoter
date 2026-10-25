import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatWhen } from "@/lib/format";
import { listOpenRounds } from "@/lib/rounds";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.vote.listTitle };

export default function VoteHomePage() {
  const rounds = listOpenRounds();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-5xl">{t.vote.listTitle}</h1>
      <p className="mt-3 max-w-xl text-muted">{t.vote.listLead}</p>
      {rounds.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <h2 className="font-display text-3xl">{t.vote.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{t.vote.emptyBody}</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {rounds.map((round) => (
            <li key={round.id}>
              <Link href={`/vote/${round.id}`} className="flex items-start justify-between gap-4 px-5 py-5 transition hover:bg-paper">
                <div>
                  <h2 className="font-display text-3xl">{round.title}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {round.domainCount} {t.common.domains} · {t.common.openedAt} {formatWhen(round.createdAt)}
                  </p>
                  {round.parentTitle ? <p className="mt-1 text-sm text-muted">{t.common.fromParent(round.parentTitle)}</p> : null}
                </div>
                <Badge tone="accent">{t.common.open}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
