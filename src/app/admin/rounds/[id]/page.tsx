import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, ProgressBar, buttonClass } from "@/components/ui";
import { closeRoundAction } from "@/lib/actions/rounds";
import { describeFilters, type RoundFilters } from "@/lib/filters";
import { togglePickAction } from "@/lib/actions/picks";
import { formatMoney, formatPercent, formatWhen, one, withParams } from "@/lib/format";
import {
  getBallots,
  getDomainVoters,
  getRound,
  getUserBallot,
  queryResults,
  roundCoverage,
  roundProviderCounts,
  type ResultsQuery,
} from "@/lib/rounds";
import { DeriveForm } from "./derive-form";

const PAGE_SIZE = 50;
const TABS = [
  { id: "results", label: "نتایج" },
  { id: "ballots", label: "برگه‌های رأی" },
  { id: "unviewed", label: "دیده‌نشده" },
  { id: "next", label: "دور بعد" },
] as const;

type Tab = (typeof TABS)[number]["id"];
type SortKey = ResultsQuery["sort"];

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const round = getRound(Number(id));
  return { title: round?.title ?? "دور" };
}

function pageNumber(value: string | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.floor(number);
}

export default async function AdminRoundPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const round = getRound(Number(id));
  if (!round) notFound();

  const coverage = roundCoverage(round.id);
  const fromPool = round.source === "pool";
  const parent = round.parentRoundId ? getRound(round.parentRoundId) : undefined;
  const viewed = coverage.viewed;
  const percent = formatPercent(viewed, coverage.total);
  const tab: Tab = TABS.some((item) => item.id === one(query.tab)) ? (one(query.tab) as Tab) : "results";
  const sort = (["position", "name", "price", "votes", "viewers"] as const).includes(one(query.sort) as SortKey)
    ? (one(query.sort) as SortKey)
    : "position";
  const dir = one(query.dir) === "desc" ? "desc" : "asc";
  const imported = one(query.imported);
  const confirmClose = one(query.confirmClose) === "1";
  const base = `/admin/rounds/${round.id}`;

  let lineage = "";
  if (round.filterJson && parent) {
    try {
      lineage = describeFilters(JSON.parse(round.filterJson) as RoundFilters, parent.title);
    } catch {
      lineage = `برگرفته از ${parent.title}`;
    }
  } else if (parent) {
    lineage = `برگرفته از ${parent.title}`;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm text-muted">
        <Link href="/admin" className="underline decoration-line underline-offset-4 hover:text-ink">
          دورها
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl">{round.title}</h1>
            <Badge tone={round.status === "open" ? "accent" : "muted"}>{round.status === "open" ? "باز" : "بسته"}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted">
            {coverage.total} دامنه{fromPool ? " از استخر فروشی" : ""} · باز شده {formatWhen(round.createdAt)}
            {round.closedAt ? ` · بسته شده ${formatWhen(round.closedAt)}` : ""}
          </p>
          {lineage ? <p className="mt-1 text-sm text-muted">{lineage}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`${base}/export`} className={buttonClass("secondary")}>
            خروجی CSV
          </a>
          {round.status === "open" && !confirmClose ? (
            <Link href={withParams(base, { confirmClose: 1, tab })} className={buttonClass("secondary")}>
              بستن دور
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {imported ? (
          <Alert tone="success">
            این دور با {imported} دامنه باز شد.
            {Number(one(query.skippedEmpty) ?? 0) || Number(one(query.skippedDuplicate) ?? 0)
              ? ` ${one(query.skippedEmpty) ?? 0} ردیف خالی و ${one(query.skippedDuplicate) ?? 0} تکراری رد شد.`
              : ""}
          </Alert>
        ) : null}
        {one(query.derived) === "1" ? (
          <Alert tone="success">این دور از دور قبلی ساخته شد. رأی‌ها و بازدیدها از صفر شروع می‌شوند.</Alert>
        ) : null}
        {one(query.closed) === "1" ? <Alert>این دور بسته است. رأی‌ها و بازدیدها ثابت مانده‌اند.</Alert> : null}
        {confirmClose && round.status === "open" ? (
          <form action={closeRoundAction} className="rounded-xl border border-line bg-card p-4">
            <input type="hidden" name="roundId" value={round.id} />
            <p className="text-sm">رأی‌دهندگان دیگر نمی‌توانند در این دور رأی بدهند یا بازدید تازه ثبت کنند.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className={buttonClass()}>همین حالا ببند</button>
              <Link href={withParams(base, { tab })} className={buttonClass("secondary")}>
                انصراف
              </Link>
            </div>
          </form>
        ) : null}
      </div>

      <section className="mt-8 rounded-xl border border-line bg-card p-5">
        <ProgressBar value={percent} label="دامنه‌هایی که دست‌کم یک رأی‌دهنده دیده است" />
        <p className="mt-2 text-sm text-muted">
          {viewed} از {coverage.total} دامنه باز شده است. هر دامنه یک بار شمرده می‌شود، هرچند چند رأی‌دهنده آن را باز کنند.
        </p>
      </section>

      <div className="mt-8 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="بخش‌های دور">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <Link
              key={item.id}
              href={withParams(base, { tab: item.id })}
              role="tab"
              aria-selected={active}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap ${
                active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        {tab === "results" ? (
          <Results
            base={base}
            fromPool={fromPool}
            query={{
              sort,
              dir,
              page: pageNumber(one(query.page)),
              pageSize: PAGE_SIZE,
              provider: one(query.provider) || undefined,
              pickedOnly: one(query.picked) === "1",
              search: one(query.q)?.trim() || undefined,
            }}
            domainId={Number(one(query.domain))}
            roundId={round.id}
          />
        ) : null}
        {tab === "ballots" ? <Ballots base={base} roundId={round.id} voterId={Number(one(query.voter))} /> : null}
        {tab === "unviewed" ? <Unviewed base={base} roundId={round.id} fromPool={fromPool} page={pageNumber(one(query.page))} /> : null}
        {tab === "next" ? (
          <div>
            <h2 className="font-display text-2xl">ساخت دور بعد</h2>
            <p className="mt-2 max-w-xl text-sm text-muted">
              دامنه‌هایی که با این قاعده‌ها جور باشند نگه داشته می‌شوند. نسخهٔ تازه نام، قیمت و وضعیت پریمیوم را برمی‌دارد و رأی‌گیری را از نو شروع می‌کند.
            </p>
            <div className="mt-6">
              <DeriveForm
                roundId={round.id}
                defaultTitle={`بعدی: ${round.title}`.slice(0, 80)}
                serverError={one(query.error)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Results({
  base,
  fromPool,
  query,
  domainId,
  roundId,
}: {
  base: string;
  fromPool: boolean;
  query: ResultsQuery;
  domainId: number;
  roundId: number;
}) {
  const { sort, dir } = query;
  const { rows, total, page: current, pages } = queryResults(roundId, query);
  const providers = fromPool ? roundProviderCounts(roundId) : [];
  const keep = {
    tab: "results",
    sort,
    dir,
    provider: query.provider,
    picked: query.pickedOnly ? 1 : undefined,
    q: query.search,
  };
  const focused = rows.find((domain) => domain.id === domainId);
  const voters = focused ? getDomainVoters(roundId, focused.id) : [];
  const here = withParams(base, { ...keep, page: current });

  function header(label: string, column: ResultsQuery["sort"], align: "start" | "end" = "start") {
    const nextDir = sort === column && dir === "asc" ? "desc" : "asc";
    const mark = sort === column ? (dir === "asc" ? "↑" : "↓") : "";
    return (
      <th className={`px-3 py-3 font-medium ${align === "end" ? "text-end" : "text-start"}`}>
        <Link href={withParams(base, { ...keep, sort: column, dir: nextDir, page: 1 })} className="underline-offset-4 hover:underline">
          {label} {mark}
        </Link>
      </th>
    );
  }

  return (
    <div className="grid gap-6">
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-card p-4 text-sm" action={base}>
        <input type="hidden" name="tab" value="results" />
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <label className="grid gap-1">
          <span className="text-muted">جست‌وجوی نام</span>
          <input name="q" defaultValue={query.search} dir="ltr" className="h-9 rounded-lg border border-line bg-paper px-3 font-mono" />
        </label>
        {fromPool ? (
          <label className="grid gap-1">
            <span className="text-muted">پارکینگ</span>
            <select name="provider" defaultValue={query.provider ?? ""} className="h-9 rounded-lg border border-line bg-paper px-2">
              <option value="">همه</option>
              {providers.map((p) => (
                <option key={p.provider ?? "__none__"} value={p.provider ?? "__none__"}>
                  {p.provider ?? "بدون پارکینگ"} ({p.count.toLocaleString("fa-IR")} · {p.votes.toLocaleString("fa-IR")} رأی)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex h-9 items-center gap-2">
          <input type="checkbox" name="picked" value="1" defaultChecked={query.pickedOnly} />
          فقط منتخب‌ها
        </label>
        <button className={buttonClass("secondary")}>اعمال</button>
        <span className="ms-auto text-muted tabular-nums">{total.toLocaleString("fa-IR")} ردیف</span>
      </form>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <caption className="sr-only">آرا و بازدیدهای هر دامنه</caption>
          <thead className="bg-card text-muted">
            <tr>
              {header("#", "position")}
              {header("دامنه", "name")}
              {header("قیمت", "price", "end")}
              {fromPool ? (
                <>
                  <th className="px-3 py-3 text-start font-medium">بازار</th>
                  <th className="px-3 py-3 text-start font-medium">پارکینگ / NS</th>
                  <th className="px-3 py-3 text-start font-medium">شاهد</th>
                </>
              ) : (
                <th className="px-3 py-3 text-start font-medium">پریمیوم</th>
              )}
              {header("آرا", "votes", "end")}
              {header("بازدیدکنندگان", "viewers", "end")}
              <th className="px-3 py-3 text-center font-medium">منتخب</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((domain) => (
              <tr key={domain.id} className="border-t border-line">
                <td className="px-3 py-2.5 tabular-nums text-muted">{domain.position}</td>
                <td className="px-3 py-2.5">
                  <Link
                    href={withParams(base, { ...keep, page: current, domain: domain.id })}
                    dir="ltr"
                    className="break-all font-mono font-medium underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    {domain.name}
                  </Link>
                </td>
                <td dir="ltr" className="px-3 py-2.5 text-end tabular-nums">
                  {formatMoney(domain.price, domain.currency, fromPool)}
                </td>
                {fromPool ? (
                  <>
                    <td className="px-3 py-2.5">
                      {domain.url ? (
                        <a href={domain.url} target="_blank" rel="noreferrer noopener" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                          {domain.marketplace ?? domain.bestSource ?? "صفحهٔ فروش"} ↗
                        </a>
                      ) : (
                        <span className="text-muted">{domain.marketplace ?? domain.bestSource ?? "—"}</span>
                      )}
                    </td>
                    <td dir="ltr" className="px-3 py-2.5 text-start text-xs text-muted">
                      {domain.provider ?? "—"}
                      {domain.nsClass ? ` · ${domain.nsClass}` : ""}
                    </td>
                    <td className="px-3 py-2.5">
                      {domain.evidence === "sale_page" ? (
                        <Badge tone="accent">صفحهٔ فروش</Badge>
                      ) : domain.evidence === "nameserver" ? (
                        <Badge tone="muted">نیم‌سرور</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </>
                ) : (
                  <td className="px-3 py-2.5">
                    {domain.isPremium ? <Badge tone="gold">پریمیوم</Badge> : <span className="text-muted">معمولی</span>}
                  </td>
                )}
                <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{domain.votes}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{domain.viewers}</td>
                <td className="px-3 py-2.5 text-center">
                  <form action={togglePickAction}>
                    <input type="hidden" name="name" value={domain.name} />
                    <input type="hidden" name="back" value={here} />
                    <button
                      aria-label={domain.picked ? "حذف از منتخب‌ها" : "افزودن به منتخب‌ها"}
                      className={`text-lg leading-none ${domain.picked ? "text-gold" : "text-line hover:text-gold"}`}
                    >
                      ★
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager base={base} page={current} pages={pages} params={keep} />
      {focused ? (
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl">
            آرا برای <span dir="ltr" className="font-mono text-xl">{focused.name}</span>
          </h2>
          {voters.length === 0 ? (
            <p className="mt-2 text-sm text-muted">هنوز رأیی نیست.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {voters.map((voter) => (
                <li key={voter.id} className="py-2 text-sm">
                  <Link
                    href={withParams(base, { tab: "ballots", voter: voter.id })}
                    dir="ltr"
                    className="font-medium underline decoration-line underline-offset-4"
                  >
                    {voter.username}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Ballots({ base, roundId, voterId }: { base: string; roundId: number; voterId: number }) {
  const ballots = getBallots(roundId);
  const selected = ballots.find((ballot) => ballot.id === voterId);
  const votes = selected ? getUserBallot(roundId, selected.id) : [];

  if (ballots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <h2 className="font-display text-2xl">هنوز رأیی نیست</h2>
        <p className="mt-2 text-sm text-muted">برگه‌ها بعد از کلیک رأی‌دهنده روی یک دامنه اینجا دیده می‌شوند.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <ul className="max-h-[32rem] overflow-auto rounded-xl border border-line bg-card">
        {ballots.map((ballot) => {
          const active = ballot.id === selected?.id;
          return (
            <li key={ballot.id} className="border-b border-line last:border-b-0">
              <Link
                href={withParams(base, { tab: "ballots", voter: ballot.id })}
                className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${active ? "bg-accent-soft" : "hover:bg-paper"}`}
                aria-current={active ? "true" : undefined}
              >
                <span dir="ltr" className="font-medium">{ballot.username}</span>
                <span className="tabular-nums text-muted">{ballot.votes}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <section>
        {selected ? (
          <>
            <h2 dir="ltr" className="font-display text-2xl">{selected.username}</h2>
            <p className="mt-1 text-sm text-muted">{selected.votes} رأی</p>
            <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
              {votes.map((domain) => (
                <li key={domain.position} className="grid gap-1 px-4 py-3 sm:grid-cols-[4rem_1fr_auto] sm:items-center">
                  <span className="text-sm tabular-nums text-muted">#{domain.position}</span>
                  <span dir="ltr" className="break-all font-mono text-sm">{domain.name}</span>
                  <span dir="ltr" className="text-sm text-muted">
                    {formatMoney(domain.price, domain.currency, domain.poolName != null)}
                    {domain.isPremium ? " · پریمیوم" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">یک رأی‌دهنده را انتخاب کنید تا همهٔ دامنه‌هایی که به آن‌ها رأی داده ببینید.</p>
        )}
      </section>
    </div>
  );
}

function Unviewed({ base, roundId, fromPool, page }: { base: string; roundId: number; fromPool: boolean; page: number }) {
  const { rows, total: unseen, page: current, pages } = queryResults(roundId, {
    sort: "position",
    dir: "asc",
    page,
    pageSize: PAGE_SIZE,
    unviewedOnly: true,
  });

  if (unseen === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <h2 className="font-display text-2xl">همهٔ دامنه‌ها باز شده‌اند</h2>
        <p className="mt-2 text-sm text-muted">دست‌کم یک رأی‌دهنده هر دامنهٔ این دور را دیده است.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted">{unseen.toLocaleString("fa-IR")} دامنه را هیچ رأی‌دهنده‌ای باز نکرده است.</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="sr-only">دامنه‌هایی که کسی باز نکرده است</caption>
          <thead className="bg-card text-start text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">دامنه</th>
              <th className="px-4 py-3 text-end font-medium">قیمت</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((domain) => (
              <tr key={domain.id} className="border-t border-line">
                <td className="px-4 py-3 tabular-nums text-muted">{domain.position}</td>
                <td dir="ltr" className="px-4 py-3 break-all font-mono">{domain.name}</td>
                <td dir="ltr" className="px-4 py-3 text-end tabular-nums">{formatMoney(domain.price, domain.currency, fromPool)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager base={base} page={current} pages={pages} params={{ tab: "unviewed" }} />
    </div>
  );
}

function Pager({
  base,
  page,
  pages,
  params,
}: {
  base: string;
  page: number;
  pages: number;
  params: Record<string, string | number | undefined>;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={withParams(base, { ...params, page: page - 1 })} className={buttonClass("secondary")}>
          قبلی
        </Link>
      ) : (
        <button type="button" className={buttonClass("secondary")} disabled>
          قبلی
        </button>
      )}
      <p className="text-sm tabular-nums text-muted">
        صفحه {page} از {pages}
      </p>
      {page < pages ? (
        <Link href={withParams(base, { ...params, page: page + 1 })} className={buttonClass("secondary")}>
          بعدی
        </Link>
      ) : (
        <button type="button" className={buttonClass("secondary")} disabled>
          بعدی
        </button>
      )}
    </div>
  );
}
