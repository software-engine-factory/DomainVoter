import type { Metadata } from "next";
import Link from "next/link";
import { AutoSubmitForm } from "@/components/admin/auto-submit-form";
import { BookmarkButton } from "@/components/admin/bookmark-button";
import { Pager } from "@/components/admin/pager";
import { rate } from "@/components/admin/stat-card";
import { Badge, buttonClass, fieldClass } from "@/components/ui";
import { exploreToParams, parseExplore } from "@/lib/explore-params";
import { formatMoney, formatWhen, withParams } from "@/lib/format";
import { providerOptions, queryActivity, roundOptions, voterOptions } from "@/lib/insights";
import { SET_LABELS } from "@/lib/pool";

export const metadata: Metadata = { title: "جست‌وجوی فعالیت" };

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseExplore(await searchParams);
  const params = exploreToParams(q);
  const result = queryActivity(q);
  const users = voterOptions();
  const rounds = roundOptions();
  const providers = providerOptions();
  const back = withParams("/admin/explore", { ...params, page: q.page });
  const field = `${fieldClass} h-9`;
  const active = Object.entries(params).filter(([, v]) => v !== undefined);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">جست‌وجوی فعالیت</h1>
      <p className="mt-1 text-sm text-muted">چه کسی، چه نامی را، کِی دید یا انتخاب کرد. فیلترها در نشانی صفحه می‌مانند و قابل اشتراک‌اند.</p>

      <AutoSubmitForm action="/admin/explore" className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-line bg-card p-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
        <input name="q" defaultValue={q.q ?? ""} placeholder="بخشی از نام" dir="ltr" className={`${field} col-span-2`} />
        <select name="kind" defaultValue={q.kind === "all" ? "" : q.kind} className={field} aria-label="رویداد">
          <option value="">دیدن + انتخاب</option>
          <option value="view">فقط دیدن</option>
          <option value="vote">فقط انتخاب</option>
        </select>
        <select name="group" defaultValue={q.group === "event" ? "" : q.group} className={field} aria-label="نمایش">
          <option value="">هر رویداد</option>
          <option value="name">به تفکیک نام</option>
          <option value="user">به تفکیک کاربر</option>
        </select>
        <select name="user" defaultValue={q.userId ?? ""} className={field} aria-label="کاربر">
          <option value="">همهٔ کاربران</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <select name="round" defaultValue={q.roundId ?? ""} className={field} aria-label="دور">
          <option value="">همهٔ دورها</option>
          {rounds.map((r) => <option key={r.id} value={r.id}>#{r.id} {r.title}</option>)}
        </select>
        <select name="set" defaultValue={q.set ?? ""} className={field} aria-label="مجموعه">
          <option value="">همهٔ مجموعه‌ها</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>set {n} · {SET_LABELS[n]}</option>)}
        </select>
        <select name="provider" defaultValue={q.provider ?? ""} className={field} aria-label="پارکینگ">
          <option value="">همهٔ پارکینگ‌ها</option>
          {providers.map((p) => <option key={p.value ?? "__none__"} value={p.value ?? "__none__"}>{p.value ?? "بدون پارکینگ"} ({p.count})</option>)}
        </select>
        <select name="evidence" defaultValue={q.evidence ?? ""} className={field} aria-label="شاهد">
          <option value="">هر شاهد</option>
          <option value="sale_page">صفحهٔ فروش</option>
          <option value="nameserver">NS</option>
        </select>
        <label className="flex items-center gap-1"><span className="text-muted">از</span><input type="date" name="from" defaultValue={q.from ?? ""} className={field} /></label>
        <label className="flex items-center gap-1"><span className="text-muted">تا</span><input type="date" name="to" defaultValue={q.to ?? ""} className={field} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="voted" value="1" defaultChecked={q.votedOnly} />انتخاب‌شده</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="bookmarked" value="1" defaultChecked={q.bookmarkedOnly} />نشان‌شدهٔ مدیر</label>
        <div className="col-span-2 flex gap-2 sm:col-span-4 lg:col-span-6">
          <button className={buttonClass("primary", "sm")}>جست‌وجو</button>
          {active.length ? <Link href="/admin/explore" className={buttonClass("ghost", "sm")}>پاک کردن ({active.length})</Link> : null}
          <a href={withParams("/admin/explore/export", params)} className={`${buttonClass("ghost", "sm")} ms-auto`}>CSV</a>
        </div>
      </AutoSubmitForm>

      <div className="mt-3 text-xs text-muted">{result.total.toLocaleString("en")} ردیف</div>

      {result.group === "event" ? (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {result.rows.map((row) => (
            <li key={`${row.kind}-${row.domainId}-${row.userId}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Badge tone={row.kind === "vote" ? "accent" : "muted"}>{row.kind === "vote" ? "انتخاب" : "دید"}</Badge>
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
          {result.rows.length === 0 ? <li className="px-3 py-8 text-center text-muted">با این فیلترها چیزی نیست.</li> : null}
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
                  دیده {row.views} · انتخاب {row.votes} ({rate(row.votes, row.views)})
                  {row.voterNames ? <> · انتخاب‌کنندگان: <span dir="ltr">{row.voterNames.split(",").join(", ")}</span></> : null}
                  {row.firstVoteAt ? <> · اولین انتخاب {formatWhen(row.firstVoteAt)}</> : null}
                </div>
              </div>
              <BookmarkButton name={row.name} on={!!row.bookmarked} back={back} />
            </li>
          ))}
          {result.rows.length === 0 ? <li className="px-3 py-8 text-center text-muted">با این فیلترها چیزی نیست.</li> : null}
        </ul>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-card text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">کاربر</th>
                <th className="px-3 py-2 text-end font-medium">دیده</th>
                <th className="px-3 py-2 text-end font-medium">انتخاب</th>
                <th className="px-3 py-2 text-end font-medium">نرخ</th>
                <th className="px-3 py-2 text-end font-medium">دورها</th>
                <th className="px-3 py-2 text-end font-medium">انتخاب نشان‌شده</th>
                <th className="px-3 py-2 text-start font-medium">آخرین</th>
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
