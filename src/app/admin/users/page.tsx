import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { rate } from "@/components/admin/stat-card";
import { formatWhen } from "@/lib/format";
import { listUserStats } from "@/lib/insights";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.users.title };

export default async function UsersPage() {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const users = listUserStats();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{t.users.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {t.users.lead}
      </p>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {users.map((u) => (
          <li key={u.id}>
            <Link href={`/admin/users/${u.id}`} className="block rounded-xl border border-line bg-card p-3 hover:border-ink">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{u.username}</span>
                <span className="text-xs text-muted">{u.lastSeen ? t.users.last(formatWhen(u.lastSeen)) : t.users.neverSeen}</span>
              </div>
              <dl className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                <div><dt className="text-muted">{t.users.seen}</dt><dd className="text-base font-semibold tabular-nums">{u.views}</dd></div>
                <div><dt className="text-muted">{t.users.votes}</dt><dd className="text-base font-semibold tabular-nums">{u.votes}</dd></div>
                <div><dt className="text-muted">{t.users.rate}</dt><dd className="text-base font-semibold tabular-nums">{rate(u.votes, u.views)}</dd></div>
                <div><dt className="text-muted">{t.users.bookmarked}</dt><dd className="text-base font-semibold tabular-nums">{u.bookmarkedHits}</dd></div>
              </dl>
              <div className="mt-1 text-xs text-muted">{t.users.roundsDays(u.rounds, u.activeDays)}</div>
            </Link>
          </li>
        ))}
        {users.length === 0 ? <li className="text-muted">{t.users.empty}</li> : null}
      </ul>
    </main>
  );
}
