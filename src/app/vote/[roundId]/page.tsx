import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, buttonClass, fieldClass } from "@/components/ui";
import { requireVoter } from "@/lib/auth";
import { one } from "@/lib/format";
import { countDomains, getRound, getUserVoteCount, getUserVotedIds, getVoteCards } from "@/lib/rounds";
import { resolveWindow } from "@/lib/window";
import { VoteBoard } from "./vote-board";

type PageProps = {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { roundId } = await params;
  const round = getRound(Number(roundId));
  return { title: round?.title ?? "دور" };
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
          ? "mx-auto flex w-full max-w-7xl flex-col px-4 py-3 sm:h-[calc(100dvh-3.5rem-1px)] sm:overflow-hidden sm:px-6"
          : "mx-auto w-full max-w-3xl px-4 py-10 sm:px-6"
      }
    >
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            <Link href="/vote" className="underline decoration-line underline-offset-4 hover:text-ink">
              دورهای باز
            </Link>
          </p>
          <h1 className="truncate font-display text-3xl leading-none">{round.title}</h1>
        </div>
        {board ? (
          <form action={`/vote/${round.id}`} className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-medium">
              از
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
              تا
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
            <button className={buttonClass("secondary", "sm")}>نمایش این بازه</button>
          </form>
        ) : null}
      </div>

      {round.status !== "open" ? (
        <div className="mt-8">
          <Alert tone="info">این دور بسته است، پس رأی‌ها و بازدیدها ثابت مانده‌اند.</Alert>
        </div>
      ) : total === 0 ? (
        <div className="mt-8">
          <Alert>این دور دامنه‌ای ندارد.</Alert>
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
