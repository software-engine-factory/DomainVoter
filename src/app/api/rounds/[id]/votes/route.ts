import { getSession } from "@/lib/auth";
import { getUserVoteCount, getUserVotedIds } from "@/lib/rounds";

/** The signed-in user's (voters and admins both vote) own votes for a set of cards. User data: never long-cached. */
export async function GET(request: Request, ctx: RouteContext<"/api/rounds/[id]/votes">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const roundId = Number(id);
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter(Number.isInteger)
    .slice(0, 100);
  if (!Number.isInteger(roundId)) return Response.json({ error: "bad round" }, { status: 400 });
  return Response.json(
    { votedIds: getUserVotedIds(roundId, session.userId, ids), count: getUserVoteCount(roundId, session.userId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
