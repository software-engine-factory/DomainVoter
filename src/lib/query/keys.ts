/**
 * Every React Query key in the app. The first segment decides the cache policy:
 * - "dataset" keys hold data that only changes on import / round create / close. 12h stale, persisted,
 *   purged when the dataset version changes.
 * - "user" keys hold the signed-in user's mutable data (votes). Short stale time, never persisted,
 *   updated optimistically and invalidated by mutations.
 */
export const qk = {
  datasetVersion: () => ["meta", "dataset-version"] as const,
  /** `view` is the canonical viewParams() string, so equal views share one cache entry. */
  roundCards: (roundId: number, view: string) => ["dataset", "round", roundId, "cards", view] as const,
  myVotesAll: (roundId: number) => ["user", "votes", roundId] as const,
  myVotesPage: (roundId: number, view: string) => ["user", "votes", roundId, view] as const,
};

export const TWELVE_HOURS = 12 * 60 * 60 * 1000;
