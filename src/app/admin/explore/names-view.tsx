import Link from "next/link";
import { Suspense } from "react";
import { AutoSubmitForm } from "@/components/admin/auto-submit-form";
import { ACTIVE_SETS } from "@/lib/sets";
import { BookmarkButton } from "@/components/admin/bookmark-button";
import { PatternSlots } from "@/components/admin/pattern-slots";
import { buttonClass, fieldBase } from "@/components/ui";
import { formatMoney, withParams } from "@/lib/format";
import { roundOptions } from "@/lib/insights";
import { activeFilterCount, browseCursorFromRow, browseFacets, browsePool, browseToParams, countBrowse, NONE, parseBrowse } from "@/lib/pool-browse";
import { SET_LABELS } from "@/lib/pool";
import { t } from "@/lib/copy/fa";

const fa = (n: number) => n.toLocaleString("fa-IR");
const field = `${fieldBase} h-9 w-full text-sm`;
const chip = (on: boolean) =>
  `inline-flex h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
    on ? "border-accent bg-accent-soft text-ink" : "border-line bg-card text-muted hover:text-ink"
  }`;
const groupLabel = "shrink-0 text-xs font-semibold text-muted";

export async function NamesView({ query }: { query: Record<string, string | string[] | undefined> }) {
  const q = parseBrowse(query);
  const params = browseToParams(q);
  const result = await browsePool(q, undefined, false);
  const countPromise = countBrowse(q);
  const facetsPromise = browseFacets();
  const rounds = roundOptions();
  const active = activeFilterCount(q);
  const back = withParams("/admin/explore", { ...params, page: result.page });
  const moreCount = [q.cur, q.ev, q.cls, q.prov, q.link, q.lmin, q.lmax, q.used, q.inr, q.eng].filter((v) => v != null && v !== "").length;

  return (
    <>
      <AutoSubmitForm action="/admin/explore" className="mt-3 grid gap-2.5 rounded-xl border border-line bg-card p-3">
        {/* 9 — text + letter positions: first-class, one row on desktop */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <input
            name="q"
            type="search"
            defaultValue={q.q}
            placeholder={t.browse.search}
            dir="ltr"
            autoComplete="off"
            enterKeyHint="search"
            className={`${field} placeholder:text-end lg:max-w-xs`}
          />
          <PatternSlots key={`${q.pat}|${q.exact}`} pat={q.pat} exact={q.exact} />
        </div>

        {/* 10 length: one tap per label length (sets lmin = lmax); counts are whole-pool */}
        <Suspense fallback={null}><LengthFilters q={q} params={params} facets={facetsPromise} /></Suspense>

        {/* availability · 1 has price · 4 USD range */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1" role="radiogroup" aria-label={t.avail.label} data-testid="explore-avail">
            <span className={groupLabel}>{t.avail.label}</span>
            {([["", t.avail.any], ["sale", t.avail.sale], ["free", t.avail.free]] as const).map(([v, label]) => (
              <label key={v} className={chip(q.av === v)}>
                <input type="radio" name="av" value={v} defaultChecked={q.av === v} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1" role="radiogroup" aria-label={t.browse.hasPrice}>
            <span className={groupLabel}>{t.browse.hasPrice}</span>
            {([["", t.browse.any], ["yes", t.browse.yes], ["no", t.browse.no]] as const).map(([v, label]) => (
              <label key={v} className={chip(q.hp === v)}>
                <input type="radio" name="hp" value={v} defaultChecked={q.hp === v} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className={groupLabel}>{t.browse.usdRange}</span>
            <input name="min" inputMode="numeric" dir="ltr" defaultValue={q.min != null ? fa(q.min) : ""} placeholder={t.browse.from} aria-label={`${t.browse.usdRange} ${t.browse.from}`} className={`${fieldBase} h-8 w-24 px-2 text-sm`} />
            <span className="text-muted">–</span>
            <input name="max" inputMode="numeric" dir="ltr" defaultValue={q.max != null ? fa(q.max) : ""} placeholder={t.browse.to} aria-label={`${t.browse.usdRange} ${t.browse.to}`} className={`${fieldBase} h-8 w-24 px-2 text-sm`} />
          </div>
        </div>

        {/* 2 price source */}
        <Suspense fallback={<span className="text-xs text-muted">{t.browse.source}</span>}><SourceFilters q={q} facets={facetsPromise} /></Suspense>

        {/* 5 sets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={groupLabel}>{t.browse.sets}</span>
          {ACTIVE_SETS.map((n) => (
            <label key={n} className={chip(q.sets.includes(n))} title={t.poolSets.rule[n]}>
              <input type="checkbox" name="sets" value={n} defaultChecked={q.sets.includes(n)} className="sr-only" />
              {SET_LABELS[n]}
            </label>
          ))}
          {q.sets.length > 1 ? (
            <select name="sm" defaultValue={q.sm} aria-label={t.browse.sets} className={`${fieldBase} h-8 shrink-0 px-2 text-xs`}>
              <option value="any">{t.browse.setAny}</option>
              <option value="all">{t.browse.setAll}</option>
            </select>
          ) : null}
        </div>

        {/* 3, 6, 7, 8, 10, 11, 12 */}
        <details className="group" open={moreCount > 0}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-accent">
            <span className="transition group-open:rotate-90 rtl:-scale-x-100">›</span>
            {t.browse.more}
            {moreCount ? <span className="rounded-full bg-accent-soft px-1.5 tabular-nums text-ink">{fa(moreCount)}</span> : null}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Select name="cur" label={t.browse.currency} value={q.cur} options={[["usd", t.browse.curUsd], ["other", t.browse.curOther], ["none", t.browse.curNone]]} />
            <Select name="ev" label={t.browse.evidence} value={q.ev} options={[["sale_page", t.browse.salePage], ["nameserver", t.browse.nameserver]]} />
            <Select name="link" label={t.browse.link} value={q.link} options={[["yes", t.browse.yes], ["no", t.browse.no]]} />
            <Suspense fallback={null}><ProviderFilters q={q} facets={facetsPromise} /></Suspense>
            <label className="grid gap-1 text-xs text-muted">
              {t.browse.length}
              <span className="flex items-center gap-1">
                <input name="lmin" inputMode="numeric" dir="ltr" defaultValue={q.lmin ?? ""} placeholder={t.browse.from} className={`${field} px-2`} />
                <span>–</span>
                <input name="lmax" inputMode="numeric" dir="ltr" defaultValue={q.lmax ?? ""} placeholder={t.browse.to} className={`${field} px-2`} />
              </span>
            </label>
            <Select name="used" label={t.browse.used} value={q.used} options={[["never", t.browse.usedNever], ["used", t.browse.usedYes]]} />
            <Select name="inr" label={t.browse.inRound} value={q.inr ? String(q.inr) : ""} anyLabel={t.browse.anyRound} options={rounds.map((r) => [String(r.id), `#${r.id} · ${r.title}`])} />
            <Select name="eng" label={t.browse.engagement} value={q.eng} options={[["seen", t.browse.seen], ["voted", t.browse.voted], ["bookmarked", t.browse.bookmarked]]} />
          </div>
        </details>

        {/* 13 sort + actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          <select name="sort" defaultValue={q.sort} aria-label={t.browse.sort} className={`${fieldBase} h-9 px-2 text-sm`}>
            <option value="name">{t.browse.sortName}</option>
            <option value="price_asc">{t.browse.sortPriceAsc}</option>
            <option value="price_desc">{t.browse.sortPriceDesc}</option>
            <option value="votes">{t.browse.sortVotes}</option>
            <option value="random">{t.browse.sortRandom}</option>
          </select>
          {q.sort === "random" ? (
            <input name="seed" dir="ltr" defaultValue={q.seed} placeholder={t.browse.seed} aria-label={t.browse.seed} className={`${fieldBase} h-9 w-24 px-2 text-sm`} />
          ) : null}
          <button className={buttonClass("primary", "sm")}>{t.browse.apply}</button>
          {active ? (
            <Link href="/admin/explore" className={buttonClass("ghost", "sm")}>
              {t.browse.clear} ({fa(active)})
            </Link>
          ) : null}
          <Suspense fallback={<span className="ms-auto text-sm font-semibold tabular-nums text-muted">{t.browse.count("…")}</span>}>
            <BrowseCount count={countPromise} />
          </Suspense>
          <a href={withParams("/admin/explore/export", params)} className={buttonClass("ghost", "sm")}>CSV</a>
          {(result.total ?? result.rows.length) > 0 || result.hasMore ? (
            <Link href={withParams("/admin/rounds/new", { mode: "explore", ...params })} className={buttonClass("primary", "sm")} data-testid="explore-to-round">
              {t.w4.toRound}
            </Link>
          ) : null}
        </div>
      </AutoSubmitForm>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        {result.rows.map((row) => (
          <li key={row.name} className="flex items-center gap-2 px-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center sm:gap-3">
              <div className="flex items-baseline justify-between gap-2 sm:block">
                <span dir="ltr" className="break-all font-mono font-semibold">{row.name}</span>
                <span dir="ltr" className="shrink-0 text-xs tabular-nums sm:hidden">{row.price != null ? formatMoney(row.price, row.currency, true) : row.regPrice != null ? formatMoney(row.regPrice, "USD", true) : null}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted sm:mt-0">
                <span dir="ltr" className="hidden tabular-nums text-ink sm:inline">{row.price != null ? formatMoney(row.price, row.currency, true) : row.regPrice != null ? formatMoney(row.regPrice, "USD", true) : null}</span>
                {row.avail === "free" ? (
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 text-ink ring-1 ring-accent/30">{t.avail.freeBadge}</span>
                ) : row.source == null || row.source === NONE ? null : (
                  <span dir={row.source && row.source !== "unknown" ? "ltr" : undefined} className="rounded bg-paper px-1.5 py-0.5 ring-1 ring-line">{sourceLabel(row.source)}</span>
                )}
              </div>
              <div className="mt-1 truncate text-xs text-muted sm:mt-0" title={row.sets ? row.sets.split(",").map((n) => SET_LABELS[Number(n)]).join("، ") : undefined}>
                {row.sets ? row.sets.split(",").map((n) => SET_LABELS[Number(n)]).join(" · ") : "—"}
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-muted sm:mt-0">{t.browse.rowStats(row.rounds, row.views, row.votes)}</div>
            </div>
            {row.url ? (
              <a href={row.url} target="_blank" rel="noopener noreferrer" aria-label={t.browse.openSale} title={t.browse.openSale} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink">
                ↗
              </a>
            ) : (
              <span className="size-9 shrink-0" />
            )}
            <BookmarkButton name={row.name} on={!!row.bookmarked} back={back} />
          </li>
        ))}
        {result.rows.length === 0 ? <li className="px-3 py-10 text-center text-muted">{t.browse.empty}</li> : null}
      </ul>
      {result.page > 1 || result.hasMore ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          {result.page > 1 ? (
            <Link className={buttonClass("ghost", "sm")} href={withParams("/admin/explore", result.cursorMode && result.rows[0]
              ? { ...params, page: result.page - 1, cursor: browseCursorFromRow(q, result.rows[0]), direction: "prev" }
              : { ...params, page: result.page - 1, cursor: undefined, direction: undefined })}>{t.pager.prev}</Link>
          ) : null}
          <span className="tabular-nums text-muted">صفحهٔ {fa(result.page)}</span>
          {result.hasMore ? (
            <Link className={buttonClass("ghost", "sm")} href={withParams("/admin/explore", result.cursorMode && result.rows.at(-1)
              ? { ...params, page: result.page + 1, cursor: browseCursorFromRow(q, result.rows.at(-1)!), direction: "next" }
              : { ...params, page: result.page + 1, cursor: undefined, direction: undefined })}>{t.pager.next}</Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

async function BrowseCount({ count }: { count: Promise<number> }) {
  const total = await count;
  return <span className="ms-auto text-sm font-semibold tabular-nums">{t.browse.count(fa(total))}</span>;
}

type BrowseFacetsData = Awaited<ReturnType<typeof browseFacets>>;

async function LengthFilters({ q, params, facets }: { q: ReturnType<typeof parseBrowse>; params: Record<string, string | number | undefined>; facets: Promise<BrowseFacetsData> }) {
  const data = await facets;
  if (data.lengths.length < 2) return null;
  const exactLen = q.lmin != null && q.lmin === q.lmax ? q.lmin : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="explore-lengths">
      <span className={groupLabel}>{t.len.picker}</span>
      <Link href={withParams("/admin/explore", { ...params, lmin: undefined, lmax: undefined })} className={chip(q.lmin == null && q.lmax == null)}>{t.len.all}</Link>
      {data.lengths.map((l) => (
        <Link key={l.length} href={withParams("/admin/explore", { ...params, lmin: l.length, lmax: l.length })} className={chip(exactLen === l.length)} title={t.len.roundLength(l.length)}>
          {t.len.letters(l.length)} <span className="tabular-nums opacity-70">{fa(l.count)}</span>
        </Link>
      ))}
    </div>
  );
}

async function SourceFilters({ q, facets }: { q: ReturnType<typeof parseBrowse>; facets: Promise<BrowseFacetsData> }) {
  const data = await facets;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={groupLabel}>{t.browse.source}</span>
      {data.sources.map((s) => {
        const value = s.value ?? NONE;
        return (
          <label key={value} className={chip(q.src.includes(value))}>
            <input type="checkbox" name="src" value={value} defaultChecked={q.src.includes(value)} className="sr-only" />
            <span dir={s.value ? "ltr" : undefined}>{sourceLabel(s.value)}</span>
            <span className="tabular-nums opacity-70">{fa(s.count)}</span>
          </label>
        );
      })}
    </div>
  );
}

async function ProviderFilters({ q, facets }: { q: ReturnType<typeof parseBrowse>; facets: Promise<BrowseFacetsData> }) {
  const data = await facets;
  return <>
    <Select name="prov" label={t.browse.parking} value={q.prov} options={data.providers.map((p) => [p.value ?? NONE, `${p.value ?? t.browse.none} (${fa(p.count)})`])} />
    <Select name="cls" label={t.browse.nsClass} value={q.cls} options={data.classes.map((p) => [p.value ?? NONE, `${p.value ?? t.browse.none} (${fa(p.count)})`])} />
  </>;
}

function sourceLabel(value: string | null) {
  return value == null || value === NONE ? t.browse.noPrice : value === "unknown" ? t.browse.unknownSource : value;
}

function Select({ name, label, value, options, anyLabel }: { name: string; label: string; value: string; options: Array<readonly [string, string]>; anyLabel?: string }) {
  return (
    <label className="grid gap-1 text-xs text-muted">
      {label}
      <select name={name} defaultValue={value} className={`${field} px-2`}>
        <option value="">{anyLabel ?? t.browse.any}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
