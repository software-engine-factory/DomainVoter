"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSqlite } from "@/db";
import { domains, rounds, votes } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function toggleVote(domainId: number): Promise<{ voted: boolean; count: number } | { error: string }> {
  const session = await getSession();
  if (!session || session.role !== "voter") return { error: "برای رأی دادن با حساب رأی‌دهنده وارد شوید." };
  if (!Number.isInteger(domainId)) return { error: "این دامنه در این دور نیست." };

  const domain = getDb().select().from(domains).where(eq(domains.id, domainId)).get();
  if (!domain) return { error: "این دامنه در این دور نیست." };

  const round = getDb().select().from(rounds).where(eq(rounds.id, domain.roundId)).get();
  if (!round || round.status !== "open") return { error: "این دور بسته است." };

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
      return { error: "این رأی ذخیره شده بود. صفحه را تازه کنید و دوباره تلاش کنید." };
    }
  }

  const countRow = getSqlite()
    .prepare("SELECT COUNT(*) AS count FROM votes WHERE round_id = ? AND user_id = ?")
    .get(domain.roundId, session.userId) as { count: number };

  revalidatePath(`/admin/rounds/${domain.roundId}`);
  revalidatePath("/admin");
  return { voted: !existing, count: countRow.count };
}

export async function recordViews(roundId: number, domainIds: number[]) {
  const session = await getSession();
  if (!session || session.role !== "voter") return;
  if (!Number.isInteger(roundId)) return;

  const round = getDb().select().from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round || round.status !== "open") return;

  const ids = domainIds.filter((id) => Number.isInteger(id)).slice(0, 20);
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
