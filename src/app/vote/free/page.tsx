import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pager } from "@/components/admin/pager";
import { requireVoter } from "@/lib/auth";
import { browseFreeForVoters, freeLengthCounts, parseFreeQuery } from "@/lib/free-names";
import { withParams } from "@/lib/format";
import { getVoterFreeTab } from "@/lib/settings";
import { t } from "@/lib/copy/fa";
import { FreePrice, RegisterMenu } from "@/components/register-menu";

export const metadata: Metadata = { title: t.free.voterTitle };
export const dynamic = "force-dynamic";

const fa = (n: number) => n.toLocaleString("fa-IR");
const chip = (on: boolean) =>
  `press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${on ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink hover:bg-hover"}`;

/** Voter tab (setting voter_free_tab, off by default): unregistered names with their registration price and register menu. */
export default async function VoterFreePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireVoter();
  if (!getVoterFreeTab()) notFound();
  const q = parseFreeQuery(await searchParams);
  const [lengths, res] = await Promise.all([freeLengthCounts(), browseFreeForVoters(q)]);
  const params = { len: q.len ?? undefined };
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8" data-testid="voter-free">
      <h1 className="font-display text-3xl sm:text-4xl">{t.free.voterTitle}</h1>
      <p className="mt-1 text-sm tabular-nums text-muted">{t.free.voterCount(fa(res.total))}</p>
      <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <Link href="/vote/free" className={chip(q.len == null)}>{t.len.all}</Link>
        {lengths.map((l) => (
          <Link key={l.length} href={withParams("/vote/free", { len: l.length })} className={chip(q.len === l.length)}>
            {t.len.letters(l.length)}
          </Link>
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {res.rows.map((r, i) => {
          const label = r.name.replace(/\.com$/, "");
          return (
            <li key={r.name} className="vote-enter relative min-w-0" style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
              <div className="@container flex h-[5.75rem] flex-col rounded-xl border border-line bg-card px-3 py-2.5">
                <p dir="ltr" className="flex min-h-0 flex-1 items-center text-left">
                  <span
                    className="truncate font-mono leading-none font-semibold tracking-tight text-ink"
                    style={{ fontSize: `clamp(1.15rem, ${Math.round(84 / Math.max(label.length, 1))}cqw, 2.15rem)` }}
                  >
                    {label}
                  </span>
                  <span className="shrink-0 font-mono text-sm leading-none font-medium text-muted">.com</span>
                </p>
                <span className="mt-auto flex min-h-6 items-end pt-2">{r.regPrice != null ? <FreePrice price={r.regPrice} /> : null}</span>
              </div>
              <RegisterMenu name={r.name} />
            </li>
          );
        })}
      </ul>
      <Pager path="/vote/free" params={params} page={res.page} pages={res.pages} />
    </main>
  );
}
