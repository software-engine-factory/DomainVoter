import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, buttonClass, fieldClass } from "@/components/ui";
import { requireVoter } from "@/lib/auth";
import { one, withParams } from "@/lib/format";
import { countDomains, getRound, getUserVoteCount, getUserVotedIds, getVoteCards } from "@/lib/rounds";
import { resolveWindow } from "@/lib/window";
import { RecordViews } from "./record-views";
import { VoteGrid } from "./vote-grid";

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
  const href = (page: number) =>
    withParams(`/vote/${round.id}`, { from: window.from, to: window.to, page });

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
              دورهای باز
            </Link>
          </p>
          <h1 className="truncate font-display text-2xl leading-none sm:text-3xl">{round.title}</h1>
        </div>
        {board ? (
          <form action={`/vote/${round.id}`} className="hidden flex-wrap items-end gap-2 sm:flex">
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
        <>
          <p className="mt-2 hidden shrink-0 text-xs text-muted sm:block">
            نمایش{" "}
            <span className="font-semibold tabular-nums text-ink">
              {window.start}–{window.end}
            </span>{" "}
            از بازه {window.from}–{window.to} · صفحه {window.page} از {window.pages} · {total} دامنه. برای رأی کلیک کنید، برای برداشتن دوباره کلیک کنید.
          </p>

          <div className="mt-2 min-h-0 flex-1">
            <RecordViews roundId={round.id} domainIds={cards.map((card) => card.id)} />
            <VoteGrid
              cards={cards}
              votedIds={votedIds}
              initialCount={voteCount}
              prevHref={window.page > 1 ? href(window.page - 1) : undefined}
              nextHref={window.page < window.pages ? href(window.page + 1) : undefined}
            />
          </div>

          <div className="mt-2 hidden shrink-0 items-center justify-between gap-3 sm:flex">
            {window.page > 1 ? (
              <Link href={href(window.page - 1)} prefetch={false} className={buttonClass("secondary", "sm")}>
                ۲۰ تای قبلی
              </Link>
            ) : (
              <button type="button" className={buttonClass("secondary", "sm")} disabled>
                ۲۰ تای قبلی
              </button>
            )}
            <p className="text-sm tabular-nums text-muted">
              صفحه {window.page} از {window.pages}
            </p>
            {window.page < window.pages ? (
              <Link href={href(window.page + 1)} prefetch={false} className={buttonClass("primary", "sm")}>
                ۲۰ تای بعدی
              </Link>
            ) : (
              <button type="button" className={buttonClass("primary", "sm")} disabled>
                ۲۰ تای بعدی
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
