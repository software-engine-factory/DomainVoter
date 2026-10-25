"use client";

import { useEffect, useState } from "react";
import { useIsRestoring, useQueryClient } from "@tanstack/react-query";
import { myVotesQuery, roundCardsQuery, useMyVotes, useRoundCards, viewKey } from "@/lib/query/hooks";
import type { CardsPage, MyVotes } from "@/lib/query/fetchers";
import { hasFilters, viewParams, type VoteView } from "@/lib/vote-view";
import { t } from "@/lib/copy/fa";
import { RecordViews } from "./record-views";
import { VoteGrid } from "./vote-grid";
import { FilterBar } from "./filter-bar";
import { Pager } from "./pager";

/**
 * Client side of the vote page. The whole view (page size, page, search, position pattern) lives in
 * one state object mirrored to the URL; every view is a React Query entry keyed by its canonical
 * query string, so paging and filtering stay in place and revisits are instant.
 */
export function VoteBoard({
  roundId,
  total,
  initialView,
  initialPage,
  initialVotes,
}: {
  roundId: number;
  total: number;
  initialView: VoteView;
  initialPage: CardsPage;
  initialVotes: MyVotes;
}) {
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const [view, setView] = useState(initialView);
  const [enteredFromEnd, setEnteredFromEnd] = useState(false);
  // Bumped when filters are cleared from outside the bar, so the bar drops its local drafts too.
  const [filterReset, setFilterReset] = useState(0);
  const key = viewKey(view);
  const isInitial = key === viewKey(initialView);

  const cardsQuery = useRoundCards(roundId, view, isInitial ? initialPage : undefined);
  const data = cardsQuery.data ?? initialPage;
  const cards = data.cards;
  const ids = cards.map((card) => card.id);
  const exact = cardsQuery.isSuccess && !cardsQuery.isPlaceholderData;
  const votesQuery = useMyVotes(roundId, key, exact ? ids : [], isInitial ? initialVotes : undefined);
  const votes = votesQuery.data ?? { votedIds: [], count: initialVotes.count };
  // The server clamps the page (e.g. a filter shrank the result); navigation works from what we got.
  const page = exact ? data.page : view.page;
  const pages = data.pages;

  function update(patch: Partial<VoteView>, fromEnd = false) {
    setEnteredFromEnd(fromEnd);
    // Any filter or size change starts over at page 1; only explicit paging keeps a page number.
    setView((current) => ({ ...current, page: 1, ...patch }));
  }
  function goPage(next: number, fromEnd = false) {
    update({ page: Math.min(Math.max(next, 1), pages) }, fromEnd);
  }

  // Keep the URL shareable without a server navigation (canonical params; clamped page).
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = viewParams({ ...view, page, from: data.from, to: data.to });
    url.search = params.toString();
    window.history.replaceState(null, "", url.toString());
  }, [view, page, data.from, data.to]);

  // Prefetch the next page (cards, then that page's votes) so "next" is instant.
  useEffect(() => {
    if (restoring || !exact || page >= pages) return;
    const next = { ...view, page: page + 1 };
    void client.fetchQuery(roundCardsQuery(roundId, next)).then((nextPage) =>
      client.prefetchQuery(myVotesQuery(roundId, viewKey(next), nextPage.cards.map((card) => card.id))),
    );
  }, [client, restoring, exact, roundId, view, page, pages]);

  const filtered = hasFilters(view);

  return (
    <>
      <FilterBar key={filterReset} view={view} onChange={(patch) => update(patch)} />

      <p className="mt-2 hidden shrink-0 text-xs text-muted sm:block" aria-live="polite">
        {filtered ? (
          <span className="font-semibold text-ink">{t.vote.matched(data.matched)}</span>
        ) : (
          <>
            {t.vote.showing}{" "}
            <span className="font-semibold tabular-nums text-ink">
              {data.from + data.offset - 1}–{data.from + data.offset - 2 + cards.length}
            </span>{" "}
            {t.vote.windowInfo(data.from, data.to, page, pages, total)}
          </>
        )}
      </p>
      {filtered ? (
        <p className="mt-1.5 shrink-0 text-xs font-semibold text-ink sm:hidden" aria-hidden>
          {t.vote.matched(data.matched)}
        </p>
      ) : null}

      <div className={`mt-2 min-h-0 flex-1 transition-opacity duration-200 ${exact ? "" : "opacity-60"}`} aria-busy={!exact}>
        {exact ? <RecordViews roundId={roundId} domainIds={ids} /> : null}
        {data.matched === 0 && exact ? (
          <div className="pop-in grid h-full place-items-center rounded-xl border border-dashed border-line bg-card/60 p-6 text-center">
            <div className="grid justify-items-center gap-2">
              <p className="font-display text-lg text-ink">{t.vote.noMatchTitle}</p>
              <p className="text-sm text-muted">{t.vote.noMatchBody}</p>
              <button
                type="button"
                onClick={() => {
                  setFilterReset((n) => n + 1);
                  update({ q: "", pat: "", exact: false });
                }}
                className="press mt-1 h-9 rounded-lg border border-line bg-paper px-3 text-sm font-semibold text-ink"
              >
                {t.vote.clearFilters}
              </button>
            </div>
          </div>
        ) : (
          <VoteGrid
            key={`${key}`}
            roundId={roundId}
            viewKey={key}
            size={view.size}
            cards={cards}
            votedIds={votes.votedIds}
            count={votes.count}
            ready={exact}
            onPrev={page > 1 ? () => goPage(page - 1, true) : undefined}
            onNext={page < pages ? () => goPage(page + 1) : undefined}
            startAtEnd={enteredFromEnd}
          />
        )}
      </div>

      <Pager page={page} pages={pages} onGo={(p) => goPage(p)} mobileArrows={view.size > 20} />
    </>
  );
}
