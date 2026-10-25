"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsRestoring, useQueryClient } from "@tanstack/react-query";
import { buttonClass } from "@/components/ui";
import { myVotesQuery, roundCardsQuery, useMyVotes, useRoundCards } from "@/lib/query/hooks";
import type { Card, MyVotes } from "@/lib/query/fetchers";
import { resolveWindow } from "@/lib/window";
import { RecordViews } from "./record-views";
import { VoteGrid } from "./vote-grid";

/**
 * Client side of the vote page: paging happens in place (no server round trip) and every page of
 * cards goes through the 12h React Query cache. The server render seeds the first page.
 */
export function VoteBoard({
  roundId,
  total,
  from,
  to,
  initialPage,
  initialCards,
  initialVotes,
}: {
  roundId: number;
  total: number;
  from: number;
  to: number;
  initialPage: number;
  initialCards: Card[];
  initialVotes: MyVotes;
}) {
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const [page, setPage] = useState(initialPage);
  const window_ = useMemo(() => resolveWindow(total, String(from), String(to), String(page)), [total, from, to, page]);
  const isInitial = page === initialPage;

  const cardsQuery = useRoundCards(roundId, window_.start, window_.end, isInitial ? initialCards : undefined);
  const cards = cardsQuery.data ?? [];
  const ids = cards.map((card) => card.id);
  const exact = cardsQuery.isSuccess && !cardsQuery.isPlaceholderData;
  const votesQuery = useMyVotes(
    roundId,
    window_.start,
    window_.end,
    exact ? ids : [],
    isInitial ? initialVotes : undefined,
  );
  const votes = votesQuery.data ?? { votedIds: [], count: initialVotes.count };

  // Keep the URL shareable without a server navigation.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("from", String(window_.from));
    url.searchParams.set("to", String(window_.to));
    url.searchParams.set("page", String(window_.page));
    window.history.replaceState(window.history.state, "", url);
  }, [window_.from, window_.to, window_.page]);

  // Prefetch the next page (cards from cache or network, then that page's votes) so "next" is instant.
  useEffect(() => {
    // Wait for the persisted cache to load, otherwise we would refetch pages that are already on disk.
    if (restoring || window_.page >= window_.pages) return;
    const next = resolveWindow(total, String(from), String(to), String(window_.page + 1));
    void client.fetchQuery(roundCardsQuery(roundId, next.start, next.end)).then((nextCards) =>
      client.prefetchQuery(
        myVotesQuery(
          roundId,
          next.start,
          next.end,
          nextCards.map((card) => card.id),
        ),
      ),
    );
  }, [client, restoring, roundId, total, from, to, window_.page, window_.pages]);

  return (
    <>
      <p className="mt-2 shrink-0 text-xs text-muted">
        نمایش{" "}
        <span className="font-semibold tabular-nums text-ink">
          {window_.start}–{window_.end}
        </span>{" "}
        از بازه {window_.from}–{window_.to} · صفحه {window_.page} از {window_.pages} · {total} دامنه. برای رأی کلیک کنید، برای برداشتن دوباره کلیک کنید.
      </p>

      <div className="mt-2 min-h-0 flex-1" aria-busy={!exact}>
        {exact ? <RecordViews roundId={roundId} domainIds={ids} /> : null}
        <VoteGrid
          key={`${window_.start}-${window_.end}`}
          roundId={roundId}
          start={window_.start}
          end={window_.end}
          cards={cards}
          votedIds={votes.votedIds}
          count={votes.count}
        />
      </div>

      <div className="mt-2 flex shrink-0 items-center justify-between gap-3">
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          disabled={window_.page <= 1}
          onClick={() => setPage(window_.page - 1)}
        >
          ۲۰ تای قبلی
        </button>
        <p className="text-sm tabular-nums text-muted">
          صفحه {window_.page} از {window_.pages}
        </p>
        <button
          type="button"
          className={buttonClass("primary", "sm")}
          disabled={window_.page >= window_.pages}
          onClick={() => setPage(window_.page + 1)}
        >
          ۲۰ تای بعدی
        </button>
      </div>
    </>
  );
}
