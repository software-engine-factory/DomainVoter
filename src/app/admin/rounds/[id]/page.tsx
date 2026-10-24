import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, ProgressBar, buttonClass } from "@/components/ui";
import { closeRoundAction } from "@/lib/actions/rounds";
import { describeFilters, type RoundFilters } from "@/lib/filters";
import { formatPercent, formatPrice, formatWhen, one, withParams } from "@/lib/format";
import {
  getBallots,
  getDomainStats,
  getDomainVoters,
  getRound,
  getUserBallot,
  type DomainStat,
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
type SortKey = "position" | "name" | "price" | "votes" | "viewers";

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

function sortStats(stats: DomainStat[], sort: SortKey, dir: "asc" | "desc") {
  const factor = dir === "asc" ? 1 : -1;
  return [...stats].sort((a, b) => {
    if (sort === "name") {
      const delta = a.name.localeCompare(b.name) * factor;
      return delta || a.position - b.position;
    }
    if (sort === "price") {
      if (a.price == null && b.price == null) return a.position - b.position;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return (a.price - b.price) * factor || a.position - b.position;
    }
    return (a[sort] - b[sort]) * factor || a.position - b.position;
  });
}

export default async function AdminRoundPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const round = getRound(Number(id));
  if (!round) notFound();

  const stats = getDomainStats(round.id);
  const parent = round.parentRoundId ? getRound(round.parentRoundId) : undefined;
  const viewed = stats.filter((domain) => domain.viewers > 0).length;
  const percent = formatPercent(viewed, stats.length);
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
            {stats.length} دامنه · باز شده {formatWhen(round.createdAt)}
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
          {viewed} از {stats.length} دامنه باز شده است. هر دامنه یک بار شمرده می‌شود، هرچند چند رأی‌دهنده آن را باز کنند.
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
            stats={stats}
            sort={sort}
            dir={dir}
            page={pageNumber(one(query.page))}
            domainId={Number(one(query.domain))}
            roundId={round.id}
          />
        ) : null}
        {tab === "ballots" ? <Ballots base={base} roundId={round.id} voterId={Number(one(query.voter))} /> : null}
        {tab === "unviewed" ? <Unviewed base={base} stats={stats} page={pageNumber(one(query.page))} /> : null}
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
  stats,
  sort,
  dir,
  page,
  domainId,
  roundId,
}: {
  base: string;
  stats: DomainStat[];
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  domainId: number;
  roundId: number;
}) {
  const sorted = sortStats(stats, sort, dir);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const focused = stats.find((domain) => domain.id === domainId);
  const voters = focused ? getDomainVoters(roundId, focused.id) : [];

  function header(label: string, column: SortKey, align: "start" | "end" = "start") {
    const nextDir = sort === column && dir === "asc" ? "desc" : "asc";
    const mark = sort === column ? (dir === "asc" ? "↑" : "↓") : "";
    return (
      <th className={`px-4 py-3 font-medium ${align === "end" ? "text-end" : "text-start"}`}>
        <Link
          href={withParams(base, { tab: "results", sort: column, dir: nextDir, page: 1 })}
          className="underline-offset-4 hover:underline"
        >
          {label} {mark}
        </Link>
      </th>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">آرا و بازدیدهای هر دامنه</caption>
          <thead className="bg-card text-muted">
            <tr>
              {header("#", "position")}
              {header("دامنه", "name")}
              {header("قیمت", "price", "end")}
              <th className="px-4 py-3 text-start font-medium">پریمیوم</th>
              {header("آرا", "votes", "end")}
              {header("بازدیدکنندگان", "viewers", "end")}
            </tr>
          </thead>
          <tbody>
            {rows.map((domain) => (
              <tr key={domain.id} className="border-t border-line">
                <td className="px-4 py-3 tabular-nums text-muted">{domain.position}</td>
                <td className="px-4 py-3">
                  <Link
                    href={withParams(base, { tab: "results", sort, dir, page: current, domain: domain.id })}
                    dir="ltr"
                    className="break-all font-mono font-medium underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    {domain.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-end tabular-nums">{formatPrice(domain.price)}</td>
                <td className="px-4 py-3">
                  {domain.isPremium ? <Badge tone="gold">پریمیوم</Badge> : <span className="text-muted">معمولی</span>}
                </td>
                <td className="px-4 py-3 text-end font-semibold tabular-nums">{domain.votes}</td>
                <td className="px-4 py-3 text-end tabular-nums">{domain.viewers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager base={base} page={current} pages={pages} params={{ tab: "results", sort, dir }} />
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
                    {formatPrice(domain.price)}
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

function Unviewed({ base, stats, page }: { base: string; stats: DomainStat[]; page: number }) {
  const unseen = stats.filter((domain) => domain.viewers === 0);
  const pages = Math.max(1, Math.ceil(unseen.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = unseen.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (unseen.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
        <h2 className="font-display text-2xl">همهٔ دامنه‌ها باز شده‌اند</h2>
        <p className="mt-2 text-sm text-muted">دست‌کم یک رأی‌دهنده هر دامنهٔ این دور را دیده است.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted">{unseen.length} دامنه را هیچ رأی‌دهنده‌ای باز نکرده است.</p>
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
                <td className="px-4 py-3 text-end tabular-nums">{formatPrice(domain.price)}</td>
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
