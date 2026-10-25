"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toggleVote } from "@/lib/actions/votes";
import { viewParams, type VoteView } from "@/lib/vote-view";
import { fetchMyVotes, fetchRoundCards, type CardsPage, type MyVotes } from "./fetchers";
import { qk } from "./keys";

export const viewKey = (view: VoteView) => viewParams(view).toString();

export function roundCardsQuery(roundId: number, view: VoteView) {
  return {
    queryKey: qk.roundCards(roundId, viewKey(view)),
    queryFn: () => fetchRoundCards(roundId, view),
  };
}

export function myVotesQuery(roundId: number, key: string, ids: number[]) {
  return {
    // The ids are part of the key: the same view can resolve to other cards after a dataset change.
    queryKey: [...qk.myVotesPage(roundId, key), ids.join(",")] as const,
    queryFn: () => fetchMyVotes(roundId, ids),
    staleTime: 30_000,
    enabled: ids.length > 0,
  };
}

export function useRoundCards(roundId: number, view: VoteView, initial?: CardsPage) {
  return useQuery({
    ...roundCardsQuery(roundId, view),
    initialData: initial,
    placeholderData: keepPreviousData,
  });
}

export function useMyVotes(roundId: number, key: string, ids: number[], initial?: MyVotes) {
  // Keep showing the last page's marks while the next view's cards load (no flash of "unvoted").
  return useQuery({ ...myVotesQuery(roundId, key, ids), initialData: initial, placeholderData: keepPreviousData });
}

/** Optimistic vote toggle: flips the page's votes + the round count immediately, rolls back on error. */
export function useToggleVote(roundId: number, view: string, ids: number[]) {
  const client = useQueryClient();
  const key = myVotesQuery(roundId, view, ids).queryKey;
  return useMutation({
    mutationFn: async (domainId: number) => {
      const result = await toggleVote(domainId);
      if ("error" in result) throw new Error(result.error);
      return { domainId, ...result };
    },
    onMutate: async (domainId) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<MyVotes>(key);
      if (previous) {
        const had = previous.votedIds.includes(domainId);
        client.setQueryData<MyVotes>(key, {
          votedIds: had ? previous.votedIds.filter((id) => id !== domainId) : [...previous.votedIds, domainId],
          count: previous.count + (had ? -1 : 1),
        });
      }
      return { previous };
    },
    onError: (_error, _domainId, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSuccess: ({ domainId, voted, count }) => {
      client.setQueryData<MyVotes>(key, (current) => {
        const ids = new Set(current?.votedIds ?? []);
        if (voted) ids.add(domainId);
        else ids.delete(domainId);
        return { votedIds: [...ids], count };
      });
      // Other pages of this round only need the new count: mark them stale, refetch when shown.
      client.invalidateQueries({ queryKey: qk.myVotesAll(roundId), refetchType: "none" });
    },
  });
}
