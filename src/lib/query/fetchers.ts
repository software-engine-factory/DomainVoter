import { viewParams, type VoteView } from "@/lib/vote-view";

export type Card = { id: number; name: string; price: number | null; currency: string | null };
export type CardsPage = {
  cards: Card[];
  matched: number;
  page: number;
  pages: number;
  from: number;
  to: number;
  offset: number;
};
export type MyVotes = { votedIds: number[]; count: number };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export const fetchDatasetVersion = () => getJson<{ version: string }>("/api/dataset-version").then((r) => r.version);

export const fetchRoundCards = (roundId: number, view: VoteView) =>
  getJson<CardsPage>(`/api/rounds/${roundId}/cards?${viewParams(view).toString()}`);

export const fetchMyVotes = (roundId: number, ids: number[]) =>
  getJson<MyVotes>(`/api/rounds/${roundId}/votes?ids=${ids.join(",")}`);
