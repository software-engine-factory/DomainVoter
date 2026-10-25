import { one } from "@/lib/format";
import type { ActivityQuery } from "@/lib/insights";

type Params = Record<string, string | string[] | undefined>;

/** URL ⇄ explorer query. Same parser for the page and the CSV export so they never disagree. */
export function parseExplore(params: Params, pageSize = 50): ActivityQuery {
  const kind = one(params.kind);
  const group = one(params.group);
  const num = (key: string) => {
    const n = Number(one(params[key]));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const flag = (key: string) => ["1", "on", "true"].includes(String(one(params[key]) ?? ""));
  return {
    kind: kind === "view" || kind === "vote" ? kind : "all",
    group: group === "name" || group === "user" ? group : "event",
    userId: num("user"),
    roundId: num("round"),
    q: (one(params.q) ?? "").trim().slice(0, 80) || undefined,
    from: one(params.from) || undefined,
    to: one(params.to) || undefined,
    set: num("set"),
    provider: one(params.provider) || undefined,
    evidence: ["sale_page", "nameserver"].includes(one(params.evidence) ?? "") ? one(params.evidence) : undefined,
    bookmarkedOnly: flag("bookmarked"),
    votedOnly: flag("voted"),
    page: num("page") ?? 1,
    pageSize,
  };
}

export function exploreToParams(q: ActivityQuery): Record<string, string | number | undefined> {
  return {
    mode: "activity",
    kind: q.kind === "all" ? undefined : q.kind,
    group: q.group === "event" ? undefined : q.group,
    user: q.userId ?? undefined,
    round: q.roundId ?? undefined,
    q: q.q,
    from: q.from,
    to: q.to,
    set: q.set ?? undefined,
    provider: q.provider,
    evidence: q.evidence,
    bookmarked: q.bookmarkedOnly ? 1 : undefined,
    voted: q.votedOnly ? 1 : undefined,
  };
}
