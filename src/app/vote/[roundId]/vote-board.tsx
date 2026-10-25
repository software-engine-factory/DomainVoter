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

  function update(patch: Partial<VoteView>) {
    // Any filter or size change starts over at page 1; only explicit paging keeps a page number.
    setView((current) => ({ ...current, page: 1, ...patch }));
  }
  function goPage(next: number) {
    update({ page: Math.min(Math.max(next, 1), pages) });
  }

  // Keep the URL shareable without a server navigation (canonical params; clamped page).
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = viewParams({ ...view, page, from: data.from, to: data.to });
    params.delete("size"); // admin setting, not user state
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
      <FilterBar
        key={filterReset}
        view={view}
        total={total}
        matched={filtered || view.from != null || view.to != null ? data.matched : null}
        onChange={(patch) => update(patch)}
      />

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
                  update({ q: "", pat: "", exact: false, from: null, to: null });
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
            ready={exact}
          />
        )}
      </div>

      <Pager page={page} pages={pages} voted={votes.count} onGo={(p) => goPage(p)} />
    </>
  );
}
