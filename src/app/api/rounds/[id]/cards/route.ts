import { canSeeRound } from "@/lib/assignees";
import { getSession } from "@/lib/auth";
import { getRound, queryVoteCards } from "@/lib/rounds";
import { getVotePageSize } from "@/lib/settings";
import { parseView } from "@/lib/vote-view";

/**
 * One page of a round's cards for a view (size, page, filters). Round contents never change after
 * creation and prices only change on import (which bumps the dataset version the client cache keys
 * on), so this is safe to cache for 12h.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/rounds/[id]/cards">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const roundId = Number(id);
  if (!Number.isInteger(roundId) || !getRound(roundId)) return Response.json({ error: "bad round" }, { status: 400 });
  if (!canSeeRound(roundId, session.userId)) return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(request.url);
  const view = parseView((key) => url.searchParams.get(key), getVotePageSize());
  return Response.json(queryVoteCards(roundId, view), { headers: { "Cache-Control": "private, max-age=43200" } });
}
