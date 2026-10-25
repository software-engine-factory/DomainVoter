import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookmarkButton } from "@/components/admin/bookmark-button";
import { ViewsVotesChart } from "@/components/admin/charts";
import { Pager } from "@/components/admin/pager";
import { StatCard, rate } from "@/components/admin/stat-card";
import { Badge } from "@/components/ui";
import { formatMoney, formatWhen, one, withParams } from "@/lib/format";
import { dailyByUser, getUser, listUserStats, queryActivity, userRounds, userSetCoverage } from "@/lib/insights";
import { SET_LABELS } from "@/lib/pool";

export const metadata: Metadata = { title: "کاربر" };

const TABS = { chosen: "انتخاب‌ها", viewed: "دیده‌شده‌ها", rounds: "دورها" } as const;

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = getUser(Number(id));
  if (!user) notFound();
  const stat = listUserStats().find((u) => u.id === user.id);
  const tab = (one(query.tab) ?? "chosen") in TABS ? ((one(query.tab) ?? "chosen") as keyof typeof TABS) : "chosen";
  const page = Math.max(1, Number(one(query.page)) || 1);
  const roundId = Number(one(query.round)) || null;
  const bookmarkedOnly = one(query.bookmarked) === "1";
  const path = `/admin/users/${user.id}`;
  const back = withParams(path, { tab, page, round: roundId ?? undefined });
  const rounds = userRounds(user.id);
  const sets = userSetCoverage(user.id);
  const chart = dailyByUser(14, user.id).voteSeries.map((p) => ({ ...p, rate: p.views ? Math.round((p.votes / p.views) * 1000) / 10 : 0 }));
  const activity =
    tab === "rounds"
      ? null
      : queryActivity({ kind: tab === "chosen" ? "vote" : "view", userId: user.id, roundId, bookmarkedOnly, group: "event", page, pageSize: 50 });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link href="/admin/users" className="text-sm text-muted">→ همهٔ کاربران</Link>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-3xl sm:text-4xl">{user.username}</h1>
        <span className="text-xs text-muted">عضو از {formatWhen(user.createdAt)} · آخرین دیدن {formatWhen(stat?.lastSeen ?? null)}</span>
      </div>

      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label="دیده" value={stat?.views ?? 0} hint={`${stat?.views24h ?? 0} در ۲۴ ساعت`} />
        <StatCard label="انتخاب" value={stat?.votes ?? 0} hint={`نرخ ${rate(stat?.votes ?? 0, stat?.views ?? 0)}`} />
        <StatCard label="دورها" value={stat?.rounds ?? 0} hint={`${stat?.activeDays ?? 0} روز فعال`} />
        <StatCard label="انتخاب‌های نشان‌شده" value={stat?.bookmarkedHits ?? 0} hint={<Link className="underline" href={withParams("/admin/bookmarks", { user: user.id })}>فهرست برای پاداش</Link>} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line p-3 lg:col-span-2">
          <h2 className="text-sm font-semibold">۱۴ روز اخیر</h2>
          <ViewsVotesChart data={chart} />
        </div>
        <div className="rounded-xl border border-line p-3 text-sm">
          <h2 className="font-semibold">مجموعه‌هایی که دیده</h2>
          <ul className="mt-2 space-y-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <li key={n} className="flex justify-between gap-2">
                <span dir="ltr">set {n} · {SET_LABELS[n]}</span>
                <span className="tabular-nums">{sets[`s${n}`] ?? 0}</span>
              </li>
            ))}
            <li className="flex justify-between gap-2 border-t border-line pt-1 text-muted"><span>صفحهٔ فروش / NS</span><span className="tabular-nums">{sets.salePage ?? 0} / {sets.nameserver ?? 0}</span></li>
          </ul>
        </div>
      </section>

      <nav className="mt-6 flex gap-1 border-b border-line text-sm">
        {(Object.keys(TABS) as Array<keyof typeof TABS>).map((key) => (
          <Link
            key={key}
            href={withParams(path, { tab: key, round: roundId ?? undefined })}
            className={`-mb-px border-b-2 px-3 py-2 ${tab === key ? "border-ink font-semibold" : "border-transparent text-muted"}`}
          >
            {TABS[key]}
          </Link>
        ))}
      </nav>

      {tab === "rounds" ? (
        <ul className="mt-3 space-y-2">
          {rounds.map((r) => (
            <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/rounds/${r.id}`} className="font-semibold underline underline-offset-4">{r.title}</Link>
                <Badge tone={r.status === "open" ? "accent" : "muted"}>{r.status}</Badge>
              </div>
              <div className="mt-1 text-muted">
                دیده {r.views} از {r.size} ({rate(r.views, r.size)}) · بازهٔ ردیف‌ها {r.minPos}–{r.maxPos} · انتخاب {r.votes}
              </div>
              <div className="text-xs text-muted">{formatWhen(r.firstSeen)} تا {formatWhen(r.lastSeen)}</div>
              <Link className="text-xs underline" href={withParams(path, { tab: "viewed", round: r.id })}>نام‌های دیده‌شده در این دور</Link>
            </li>
          ))}
          {rounds.length === 0 ? <li className="py-6 text-center text-muted">هنوز دوری را باز نکرده.</li> : null}
        </ul>
      ) : activity && activity.group === "event" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {roundId ? (
              <Link className="rounded-full border border-line px-2 py-1" href={withParams(path, { tab })}>دور #{roundId} ✕</Link>
            ) : null}
            <Link className={`rounded-full border px-2 py-1 ${bookmarkedOnly ? "border-ink" : "border-line"}`} href={withParams(path, { tab, round: roundId ?? undefined, bookmarked: bookmarkedOnly ? undefined : 1 })}>
              فقط نشان‌شده‌ها {bookmarkedOnly ? "✕" : ""}
            </Link>
            <span className="text-muted">{activity.total} ردیف</span>
            <Link className="text-muted underline" href={withParams("/admin/explore", { user: user.id, kind: tab === "chosen" ? "vote" : "view", round: roundId ?? undefined })}>در جست‌وجوی فعالیت</Link>
          </div>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {activity.rows.map((row) => (
              <li key={`${row.kind}-${row.domainId}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <a dir="ltr" href={row.url ?? `https://${row.name}`} target="_blank" rel="noreferrer noopener" className="break-all font-mono">{row.name}</a>
                    {row.kind === "view" && row.voted ? <Badge tone="accent">انتخاب شد</Badge> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {formatWhen(row.at)} · <Link href={`/admin/rounds/${row.roundId}`}>{row.roundTitle}</Link> #{row.position}
                    {row.provider ? <span dir="ltr"> · {row.provider}</span> : null}
                    {" · "}<span dir="ltr">{formatMoney(row.price, row.currency, true)}</span>
                  </div>
                </div>
                <BookmarkButton name={row.name} on={!!row.bookmarked} sourceUserId={user.id} back={back} />
              </li>
            ))}
            {activity.rows.length === 0 ? <li className="px-3 py-8 text-center text-muted">چیزی نیست.</li> : null}
          </ul>
          <Pager path={path} params={{ tab, round: roundId ?? undefined, bookmarked: bookmarkedOnly ? 1 : undefined }} page={activity.page} pages={activity.pages} />
        </>
      ) : null}
    </main>
  );
}
