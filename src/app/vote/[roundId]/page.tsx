import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, buttonClass, fieldClass } from "@/components/ui";
import { requireVoter } from "@/lib/auth";
import { one } from "@/lib/format";
import { countDomains, getRound, getUserVoteCount, getUserVotedIds, getVoteCards } from "@/lib/rounds";
import { resolveWindow } from "@/lib/window";
import { VoteBoard } from "./vote-board";
import { t } from "@/lib/copy/fa";

type PageProps = {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { roundId } = await params;
  const round = getRound(Number(roundId));
  return { title: round?.title ?? t.common.round };
}

export default async function VoteRoundPage({ params, searchParams }: PageProps) {
  const session = await requireVoter();
  const { roundId } = await params;
  const query = await searchParams;
  const round = getRound(Number(roundId));
  if (!round) notFound();

  const total = countDomains(round.id);
  const window = resolveWindow(total, one(query.from), one(query.to), one(query.page));
  const cards = total === 0 ? [] : getVoteCards(round.id, window.start, window.end);
  const votedIds = getUserVotedIds(
    round.id,
    session.userId,
    cards.map((card) => card.id),
  );
  const voteCount = getUserVoteCount(round.id, session.userId);

  const board = round.status === "open" && total > 0;

  return (
    <main
      className={
        board
          ? "mx-auto flex h-[calc(100dvh-6rem)] w-full max-w-7xl flex-col overflow-hidden px-4 py-3 sm:h-[calc(100dvh-3.5rem-1px)] sm:px-6"
          : "mx-auto w-full max-w-3xl px-4 py-10 sm:px-6"
      }
    >
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="hidden text-xs text-muted sm:block">
            <Link href="/vote" className="underline decoration-line underline-offset-4 hover:text-ink">
              {t.vote.listTitle}
            </Link>
          </p>
          <h1 className="truncate font-display text-2xl leading-none sm:text-3xl">{round.title}</h1>
        </div>
        {board ? (
          <form action={`/vote/${round.id}`} className="hidden flex-wrap items-end gap-2 sm:flex">
            <label className="grid gap-1 text-xs font-medium">
              {t.vote.rangeFrom}
              <input
                name="from"
                dir="ltr"
                type="number"
                min={1}
                max={total}
                defaultValue={window.from}
                required
                className={`${fieldClass} h-9! w-20 text-sm!`}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              {t.vote.rangeTo}
              <input
                name="to"
                dir="ltr"
                type="number"
                min={1}
                max={total}
                defaultValue={window.to}
                required
                className={`${fieldClass} h-9! w-20 text-sm!`}
              />
            </label>
            <button className={buttonClass("secondary", "sm")}>{t.vote.showRange}</button>
          </form>
        ) : null}
      </div>

      {round.status !== "open" ? (
        <div className="mt-8">
          <Alert tone="info">{t.vote.closedNotice}</Alert>
        </div>
      ) : total === 0 ? (
        <div className="mt-8">
          <Alert>{t.vote.noDomains}</Alert>
        </div>
      ) : (
        <VoteBoard
          roundId={round.id}
          total={total}
          from={window.from}
          to={window.to}
          initialPage={window.page}
          initialCards={cards}
          initialVotes={{ votedIds, count: voteCount }}
        />
      )}
    </main>
  );
}
