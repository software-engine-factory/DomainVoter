import type { Metadata } from "next";
import Link from "next/link";
import { AutoSubmitForm } from "@/components/admin/auto-submit-form";
import { BookmarkButton } from "@/components/admin/bookmark-button";
import { Pager } from "@/components/admin/pager";
import { rate } from "@/components/admin/stat-card";
import { Badge, buttonClass, fieldBase } from "@/components/ui";
import { exploreToParams, parseExplore } from "@/lib/explore-params";
import { formatMoney, formatWhen, withParams } from "@/lib/format";
import { providerOptions, queryActivity, roundOptions, voterOptions } from "@/lib/insights";
import { SET_LABELS } from "@/lib/pool";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.explore.title };

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseExplore(await searchParams);
  const params = exploreToParams(q);
  const result = queryActivity(q);
  const users = voterOptions();
  const rounds = roundOptions();
  const providers = providerOptions();
  const back = withParams("/admin/explore", { ...params, page: q.page });
  const field = `${fieldBase} h-9 w-full`;
  const active = Object.entries(params).filter(([, v]) => v !== undefined);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{t.explore.title}</h1>
      <p className="mt-1 text-sm text-muted">{t.explore.lead}</p>

      <AutoSubmitForm action="/admin/explore" className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-line bg-card p-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
        <input name="q" defaultValue={q.q ?? ""} placeholder={t.explore.namePart} dir="ltr" className={`${field} col-span-2`} />
        <select name="kind" defaultValue={q.kind === "all" ? "" : q.kind} className={field} aria-label={t.explore.event}>
          <option value="">{t.explore.seenAndVotes}</option>
          <option value="view">{t.explore.onlySeen}</option>
          <option value="vote">{t.explore.onlyVotes}</option>
        </select>
        <select name="group" defaultValue={q.group === "event" ? "" : q.group} className={field} aria-label={t.explore.view}>
          <option value="">{t.explore.perEvent}</option>
          <option value="name">{t.explore.byName}</option>
          <option value="user">{t.explore.byUser}</option>
        </select>
        <select name="user" defaultValue={q.userId ?? ""} className={field} aria-label={t.explore.user}>
          <option value="">{t.explore.allUsers}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <select name="round" defaultValue={q.roundId ?? ""} className={field} aria-label={t.explore.round}>
          <option value="">{t.explore.allRounds}</option>
          {rounds.map((r) => <option key={r.id} value={r.id}>#{r.id} {r.title}</option>)}
        </select>
        <select name="set" defaultValue={q.set ?? ""} className={field} aria-label={t.explore.set}>
          <option value="">{t.explore.allSets}</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>set {n} · {SET_LABELS[n]}</option>)}
        </select>
        <select name="provider" defaultValue={q.provider ?? ""} className={field} aria-label={t.explore.provider}>
          <option value="">{t.explore.allProviders}</option>
          {providers.map((p) => <option key={p.value ?? "__none__"} value={p.value ?? "__none__"}>{p.value ?? t.explore.noProvider} ({p.count})</option>)}
        </select>
        <select name="evidence" defaultValue={q.evidence ?? ""} className={field} aria-label={t.explore.evidence}>
          <option value="">{t.explore.anyEvidence}</option>
          <option value="sale_page">{t.explore.salePage}</option>
          <option value="nameserver">NS</option>
        </select>
        <label className="flex items-center gap-1"><span className="text-muted">{t.explore.from}</span><input type="date" name="from" defaultValue={q.from ?? ""} className={field} /></label>
        <label className="flex items-center gap-1"><span className="text-muted">{t.explore.to}</span><input type="date" name="to" defaultValue={q.to ?? ""} className={field} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="voted" value="1" defaultChecked={q.votedOnly} />{t.explore.votedOnly}</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="bookmarked" value="1" defaultChecked={q.bookmarkedOnly} />{t.explore.bookmarkedOnly}</label>
        <div className="col-span-2 flex gap-2 sm:col-span-4 lg:col-span-6">
          <button className={buttonClass("primary", "sm")}>{t.explore.search}</button>
          {active.length ? <Link href="/admin/explore" className={buttonClass("ghost", "sm")}>{t.explore.clear(active.length)}</Link> : null}
          <a href={withParams("/admin/explore/export", params)} className={`${buttonClass("ghost", "sm")} ms-auto`}>CSV</a>
        </div>
      </AutoSubmitForm>

      <div className="mt-3 text-xs text-muted">{result.total.toLocaleString("en")} {t.explore.rows}</div>

      {result.group === "event" ? (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {result.rows.map((row) => (
            <li key={`${row.kind}-${row.domainId}-${row.userId}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Badge tone={row.kind === "vote" ? "accent" : "muted"}>{row.kind === "vote" ? t.explore.kindVote : t.explore.kindView}</Badge>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={withParams("/admin/explore", { q: row.name, group: "name" })} dir="ltr" className="break-all font-mono">{row.name}</Link>
                  <span className="text-xs" dir="ltr">{formatMoney(row.price, row.currency, true)}</span>
                </div>
                <div className="text-xs text-muted">
                  <Link className="underline" href={`/admin/users/${row.userId}`}>{row.username}</Link> · {formatWhen(row.at)} ·{" "}
                  <Link href={`/admin/rounds/${row.roundId}`}>{row.roundTitle}</Link> #{row.position}
                  {row.provider ? <span dir="ltr"> · {row.provider}</span> : null}
                </div>
              </div>
              <BookmarkButton name={row.name} on={!!row.bookmarked} sourceUserId={row.kind === "vote" ? row.userId : undefined} back={back} />
            </li>
          ))}
          {result.rows.length === 0 ? <li className="px-3 py-8 text-center text-muted">{t.explore.empty}</li> : null}
        </ul>
      ) : result.group === "name" ? (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {result.rows.map((row) => (
            <li key={row.name} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <a href={row.url ?? `https://${row.name}`} target="_blank" rel="noreferrer noopener" dir="ltr" className="break-all font-mono">{row.name} ↗</a>
                  <span className="text-xs" dir="ltr">{formatMoney(row.price, row.currency, true)}</span>
                </div>
                <div className="text-xs text-muted">
                  {t.explore.nameLine(row.views, row.votes, rate(row.votes, row.views))}
                  {row.voterNames ? <>{t.explore.voters}<span dir="ltr">{row.voterNames.split(",").join(", ")}</span></> : null}
                  {row.firstVoteAt ? <>{t.explore.firstVote}{formatWhen(row.firstVoteAt)}</> : null}
                </div>
              </div>
              <BookmarkButton name={row.name} on={!!row.bookmarked} back={back} />
            </li>
          ))}
          {result.rows.length === 0 ? <li className="px-3 py-8 text-center text-muted">{t.explore.empty}</li> : null}
        </ul>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-card text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t.explore.colUser}</th>
                <th className="px-3 py-2 text-end font-medium">{t.explore.colSeen}</th>
                <th className="px-3 py-2 text-end font-medium">{t.explore.colVotes}</th>
                <th className="px-3 py-2 text-end font-medium">{t.explore.colRate}</th>
                <th className="px-3 py-2 text-end font-medium">{t.explore.colRounds}</th>
                <th className="px-3 py-2 text-end font-medium">{t.explore.colBookmarkedVotes}</th>
                <th className="px-3 py-2 text-start font-medium">{t.explore.colLast}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.userId} className="border-t border-line">
                  <td className="px-3 py-2"><Link className="underline" href={withParams("/admin/explore", { ...params, group: undefined, user: row.userId })}>{row.username}</Link></td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.views}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.votes}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{rate(row.votes, row.views)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.rounds}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.bookmarkedVotes}</td>
                  <td className="px-3 py-2 text-xs text-muted">{formatWhen(row.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager path="/admin/explore" params={params} page={result.page} pages={result.pages} />
    </main>
  );
}
