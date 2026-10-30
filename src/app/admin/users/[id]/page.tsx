import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { ACTIVE_SETS } from "@/lib/sets";
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
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.user.title };

const TABS = { chosen: t.user.tabVotes, viewed: t.user.tabSeen, rounds: t.user.tabRounds } as const;

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
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
      <Link href="/admin/users" className="text-sm text-muted">{t.user.back}</Link>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-3xl sm:text-4xl">{user.username}</h1>
        {user.login !== user.username ? <span dir="ltr" className="text-sm text-muted">{user.login}</span> : null}
        <span className="text-xs text-muted">{t.user.memberSince(formatWhen(user.createdAt), formatWhen(stat?.lastSeen ?? null))}</span>
      </div>

      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label={t.user.seen} value={stat?.views ?? 0} hint={t.user.seen24h(stat?.views24h ?? 0)} />
        <StatCard label={t.user.votes} value={stat?.votes ?? 0} hint={t.user.rate(rate(stat?.votes ?? 0, stat?.views ?? 0))} />
        <StatCard label={t.user.rounds} value={stat?.rounds ?? 0} hint={t.user.activeDays(stat?.activeDays ?? 0)} />
        <StatCard label={t.user.bookmarkedVotes} value={stat?.bookmarkedHits ?? 0} hint={<Link className="underline" href={withParams("/admin/bookmarks", { user: user.id })}>{t.user.bonusList}</Link>} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line p-3 lg:col-span-2">
          <h2 className="text-sm font-semibold">{t.user.last14}</h2>
          <ViewsVotesChart data={chart} />
        </div>
        <div className="rounded-xl border border-line p-3 text-sm">
          <h2 className="font-semibold">{t.user.setsSeen}</h2>
          <ul className="mt-2 space-y-1">
            {ACTIVE_SETS.map((n) => (
              <li key={n} className="flex justify-between gap-2">
                <span>{SET_LABELS[n]}</span>
                <span className="tabular-nums">{sets[`s${n}`] ?? 0}</span>
              </li>
            ))}
            <li className="flex justify-between gap-2 border-t border-line pt-1 text-muted"><span>{t.user.saleNs}</span><span className="tabular-nums">{sets.salePage ?? 0} / {sets.nameserver ?? 0}</span></li>
          </ul>
        </div>
      </section>

      <nav className="mt-6 flex gap-1 border-b border-line text-sm">
        {(Object.keys(TABS) as Array<keyof typeof TABS>).map((key) => (
          <Link
            key={key}
            href={withParams(path, { tab: key, round: roundId ?? undefined })}
            scroll={false}
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
                {t.user.roundLine(r.views, r.size, rate(r.views, r.size), r.minPos, r.maxPos, r.votes)}
              </div>
              <div className="text-xs text-muted">{formatWhen(r.firstSeen)} {t.user.until} {formatWhen(r.lastSeen)}</div>
              <Link scroll={false} className="text-xs underline" href={withParams(path, { tab: "viewed", round: r.id })}>{t.user.seenInRound}</Link>
            </li>
          ))}
          {rounds.length === 0 ? <li className="py-6 text-center text-muted">{t.user.noRounds}</li> : null}
        </ul>
      ) : activity && activity.group === "event" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {roundId ? (
              <Link scroll={false} className="rounded-full border border-line px-2 py-1" href={withParams(path, { tab })}>{t.user.roundChip(roundId)}</Link>
            ) : null}
            <Link scroll={false} className={`rounded-full border px-2 py-1 ${bookmarkedOnly ? "border-ink" : "border-line"}`} href={withParams(path, { tab, round: roundId ?? undefined, bookmarked: bookmarkedOnly ? undefined : 1 })}>
              {t.user.onlyBookmarked} {bookmarkedOnly ? "✕" : ""}
            </Link>
            <span className="text-muted">{t.user.rows(activity.total)}</span>
            <Link className="text-muted underline" href={withParams("/admin/explore", { mode: "activity", user: user.id, kind: tab === "chosen" ? "vote" : "view", round: roundId ?? undefined })}>{t.user.inExplore}</Link>
          </div>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {activity.rows.map((row) => (
              <li key={`${row.kind}-${row.domainId}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <a dir="ltr" href={row.url ?? `https://${row.name}`} target="_blank" rel="noreferrer noopener" className="break-all font-mono">{row.name}</a>
                    {row.kind === "view" && row.voted ? <Badge tone="accent">{t.user.voted}</Badge> : null}
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
            {activity.rows.length === 0 ? <li className="px-3 py-8 text-center text-muted">{t.user.empty}</li> : null}
          </ul>
          <Pager path={path} params={{ tab, round: roundId ?? undefined, bookmarked: bookmarkedOnly ? 1 : undefined }} page={activity.page} pages={activity.pages} />
        </>
      ) : null}
    </main>
  );
}
