export type Card = { id: number; name: string };
export type MyVotes = { votedIds: number[]; count: number };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export const fetchDatasetVersion = () => getJson<{ version: string }>("/api/dataset-version").then((r) => r.version);

export const fetchRoundCards = (roundId: number, start: number, end: number) =>
  getJson<{ cards: Card[] }>(`/api/rounds/${roundId}/cards?start=${start}&end=${end}`).then((r) => r.cards);

export const fetchMyVotes = (roundId: number, ids: number[]) =>
  getJson<MyVotes>(`/api/rounds/${roundId}/votes?ids=${ids.join(",")}`);
