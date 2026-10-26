import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui";
import { requireVoter } from "@/lib/auth";
import { one } from "@/lib/format";
import { countDomains, getRound, roundLabelLength, getUserVoteCount, getUserVotedIds, queryVoteCards } from "@/lib/rounds";
import { canSeeRound } from "@/lib/assignees";
import { getSession } from "@/lib/auth";
import { getVotePageSize } from "@/lib/settings";
import { parseView } from "@/lib/vote-view";
import { VoteBoard } from "./vote-board";
import { t } from "@/lib/copy/fa";

type PageProps = {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { roundId } = await params;
  const session = await getSession();
  const round = session && canSeeRound(Number(roundId), session.userId) ? getRound(Number(roundId)) : undefined;
  return { title: round?.title ?? t.common.round };
}

export default async function VoteRoundPage({ params, searchParams }: PageProps) {
  const session = await requireVoter();
  const { roundId } = await params;
  const query = await searchParams;
  // Hidden (assigned to others) rounds are a plain 404, same as a missing one.
  const round = canSeeRound(Number(roundId), session.userId) ? getRound(Number(roundId)) : undefined;
  if (!round) notFound();

  const total = countDomains(round.id);
  const view = parseView((key) => one(query[key]), getVotePageSize());
  const initialPage = queryVoteCards(round.id, view, total);
  const votedIds = getUserVotedIds(
    round.id,
    session.userId,
    initialPage.cards.map((card) => card.id),
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
          <h1 className="truncate font-display text-xl leading-tight sm:text-3xl sm:leading-none">{round.title}</h1>
        </div>
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
          labelLength={roundLabelLength(round.id)}
          initialView={{ ...view, page: initialPage.page }}
          initialPage={initialPage}
          initialVotes={{ votedIds, count: voteCount }}
        />
      )}
    </main>
  );
}
