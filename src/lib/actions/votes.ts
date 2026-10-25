"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSqlite } from "@/db";
import { domains, rounds, votes } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { t } from "@/lib/copy/fa";

export async function toggleVote(domainId: number): Promise<{ voted: boolean; count: number } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: t.vote.err.login };
  if (!Number.isInteger(domainId)) return { error: t.vote.err.notInRound };

  const domain = getDb().select().from(domains).where(eq(domains.id, domainId)).get();
  if (!domain) return { error: t.vote.err.notInRound };

  const round = getDb().select().from(rounds).where(eq(rounds.id, domain.roundId)).get();
  if (!round || round.status !== "open") return { error: t.vote.err.closed };

  const existing = getDb()
    .select()
    .from(votes)
    .where(and(eq(votes.domainId, domainId), eq(votes.userId, session.userId)))
    .get();

  if (existing) {
    getDb().delete(votes).where(eq(votes.id, existing.id)).run();
  } else {
    try {
      getDb()
        .insert(votes)
        .values({
          roundId: domain.roundId,
          domainId,
          userId: session.userId,
          createdAt: new Date(),
        })
        .run();
    } catch {
      return { error: t.vote.err.conflict };
    }
  }

  const countRow = getSqlite()
    .prepare("SELECT COUNT(*) AS count FROM votes WHERE round_id = ? AND user_id = ?")
    .get(domain.roundId, session.userId) as { count: number };

  revalidatePath(`/admin/rounds/${domain.roundId}`);
  revalidatePath("/admin");
  revalidatePath("/vote/bookmarks");
  return { voted: !existing, count: countRow.count };
}

/** Idempotent: sets the caller's vote on a domain to `want` (used by the bookmarks page, so double taps and undo can never flip twice). */
export async function setVote(domainId: number, want: boolean): Promise<{ voted: boolean; count: number } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: t.vote.err.login };
  if (!Number.isInteger(domainId) || typeof want !== "boolean") return { error: t.vote.err.notInRound };
  const domain = getDb().select().from(domains).where(eq(domains.id, domainId)).get();
  if (!domain) return { error: t.vote.err.notInRound };
  const round = getDb().select().from(rounds).where(eq(rounds.id, domain.roundId)).get();
  if (!round || round.status !== "open") return { error: t.vote.err.closed };
  const sqlite = getSqlite();
  if (want) {
    sqlite
      .prepare("INSERT INTO votes (round_id, domain_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(domain_id, user_id) DO NOTHING")
      .run(domain.roundId, domainId, session.userId, Date.now());
  } else {
    sqlite.prepare("DELETE FROM votes WHERE domain_id = ? AND user_id = ?").run(domainId, session.userId);
  }
  const countRow = sqlite
    .prepare("SELECT COUNT(*) AS count FROM votes WHERE round_id = ? AND user_id = ?")
    .get(domain.roundId, session.userId) as { count: number };
  revalidatePath(`/admin/rounds/${domain.roundId}`);
  revalidatePath("/admin");
  revalidatePath("/vote/bookmarks");
  return { voted: want, count: countRow.count };
}

export async function recordViews(roundId: number, domainIds: number[]) {
  const session = await getSession();
  if (!session) return;
  if (!Number.isInteger(roundId)) return;

  const round = getDb().select().from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round || round.status !== "open") return;

  const ids = domainIds.filter((id) => Number.isInteger(id)).slice(0, 100);
  if (ids.length === 0) return;

  const sqlite = getSqlite();
  const insert = sqlite.prepare(
    `INSERT INTO views (round_id, domain_id, user_id, viewed_at)
     SELECT ?, d.id, ?, ?
     FROM domains d
     WHERE d.round_id = ? AND d.id = ?
     ON CONFLICT(domain_id, user_id) DO NOTHING`,
  );
  const now = Date.now();
  const write = sqlite.transaction((domainIdList: number[]) => {
    for (const id of domainIdList) insert.run(roundId, session.userId, now, roundId, id);
  });
  write(ids);
  revalidatePath(`/admin/rounds/${roundId}`);
  revalidatePath("/admin");
}
