import { getSession } from "@/lib/auth";
import { getVoteCards } from "@/lib/rounds";
import { VOTE_PAGE_SIZE } from "@/lib/window";

/** One page of a round's cards. Round contents never change after creation, so this is safe to cache for 12h. */
export async function GET(request: Request, ctx: RouteContext<"/api/rounds/[id]/cards">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const roundId = Number(id);
  const start = Number(url.searchParams.get("start"));
  const end = Number(url.searchParams.get("end"));
  if (![roundId, start, end].every(Number.isInteger) || end < start || end - start >= VOTE_PAGE_SIZE) {
    return Response.json({ error: "bad range" }, { status: 400 });
  }
  return Response.json(
    { cards: getVoteCards(roundId, start, end) },
    { headers: { "Cache-Control": "private, max-age=43200" } },
  );
}
