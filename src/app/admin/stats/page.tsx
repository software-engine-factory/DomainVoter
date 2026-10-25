import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { HourChart, PerUserChart, ViewsVotesChart } from "@/components/admin/charts";
import { AutoSubmitForm } from "@/components/admin/auto-submit-form";
import { StatCard, rate } from "@/components/admin/stat-card";
import { fieldBase } from "@/components/ui";
import { one } from "@/lib/format";
import { dailyByUser, dailyTotals, hourlyProfile, listUserStats, overallTotals } from "@/lib/insights";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.stats.title };

export default async function StatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const params = await searchParams;
  const days = [7, 14, 30, 90].includes(Number(one(params.days))) ? Number(one(params.days)) : 14;
  const totals = overallTotals();
  const daily = dailyTotals(days);
  const perUser = dailyByUser(days);
  const hours = hourlyProfile();
  const users = listUserStats();
  const windowViews = daily.reduce((s, d) => s + d.views, 0);
  const windowVotes = daily.reduce((s, d) => s + d.votes, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl sm:text-4xl">{t.stats.title}</h1>
        <AutoSubmitForm action="/admin/stats" className="flex items-center gap-2 text-sm">
          <label htmlFor="days" className="text-muted">{t.stats.range}</label>
          <select id="days" name="days" defaultValue={String(days)} className={`${fieldBase} h-9 w-28`}>
            {[7, 14, 30, 90].map((d) => (
              <option key={d} value={d}>{t.stats.days(d)}</option>
            ))}
          </select>
        </AutoSubmitForm>
      </div>
      <p className="mt-1 text-xs text-muted">{t.stats.tzNote}</p>

      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label={t.stats.seenTotal} value={totals.views.toLocaleString("en")} hint={t.stats.last24(totals.views24h)} />
        <StatCard label={t.stats.votesTotal} value={totals.votes.toLocaleString("en")} hint={t.stats.last24(totals.votes24h)} />
        <StatCard label={t.stats.voteRate} value={rate(totals.votes, totals.views)} hint={t.stats.inRange(rate(windowVotes, windowViews))} />
        <StatCard label={t.stats.activeUsers} value={`${totals.activeUsers} / ${totals.voters}`} hint={t.stats.bookmarks(totals.bookmarks)} />
      </section>

      <section className="mt-6 rounded-xl border border-line p-3 sm:p-4">
        <h2 className="text-sm font-semibold">{t.stats.daily}</h2>
        <ViewsVotesChart data={daily} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line p-3 sm:p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">{t.stats.dailyByUser}</h2>
          <PerUserChart data={perUser.series} users={perUser.users} />
        </div>
        <div className="rounded-xl border border-line p-3 sm:p-4">
          <h2 className="text-sm font-semibold">{t.stats.hours}</h2>
          <HourChart data={hours} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">{t.stats.users}</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-card text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t.stats.colUser}</th>
                <th className="px-3 py-2 text-end font-medium">{t.stats.colSeen}</th>
                <th className="px-3 py-2 text-end font-medium">{t.stats.colVotes}</th>
                <th className="px-3 py-2 text-end font-medium">{t.stats.colRate}</th>
                <th className="px-3 py-2 text-end font-medium">{t.stats.colPerDay}</th>
                <th className="px-3 py-2 text-end font-medium">{t.stats.col24h}</th>
                <th className="px-3 py-2 text-end font-medium">{t.stats.colBookmarked}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-3 py-2"><Link className="underline underline-offset-4" href={`/admin/users/${u.id}`}>{u.username}</Link></td>
                  <td className="px-3 py-2 text-end tabular-nums">{u.views}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{u.votes}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{rate(u.votes, u.views)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{u.activeDays ? Math.round(u.views / u.activeDays) : 0}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{u.views24h}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{u.bookmarkedHits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
