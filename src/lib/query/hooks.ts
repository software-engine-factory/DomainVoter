"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toggleVote } from "@/lib/actions/votes";
import { fetchMyVotes, fetchRoundCards, type Card, type MyVotes } from "./fetchers";
import { qk } from "./keys";

export function roundCardsQuery(roundId: number, start: number, end: number) {
  return {
    queryKey: qk.roundCards(roundId, start, end),
    queryFn: () => fetchRoundCards(roundId, start, end),
  };
}

export function myVotesQuery(roundId: number, start: number, end: number, ids: number[]) {
  return {
    queryKey: qk.myVotesPage(roundId, start, end),
    queryFn: () => fetchMyVotes(roundId, ids),
    staleTime: 30_000,
    enabled: ids.length > 0,
  };
}

export function useRoundCards(roundId: number, start: number, end: number, initial?: Card[]) {
  return useQuery({
    ...roundCardsQuery(roundId, start, end),
    initialData: initial,
    placeholderData: keepPreviousData,
  });
}

export function useMyVotes(roundId: number, start: number, end: number, ids: number[], initial?: MyVotes) {
  return useQuery({ ...myVotesQuery(roundId, start, end, ids), initialData: initial });
}

/** Optimistic vote toggle: flips the page's votes + the round count immediately, rolls back on error. */
export function useToggleVote(roundId: number, start: number, end: number) {
  const client = useQueryClient();
  const key = qk.myVotesPage(roundId, start, end);
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
