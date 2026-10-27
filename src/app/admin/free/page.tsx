import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Alert, Badge, buttonClass, fieldClass } from "@/components/ui";
import { Pager } from "@/components/admin/pager";
import { uploadFreeAction } from "@/lib/actions/free";
import { browseFree, freeLengthCounts, parseFreeQuery } from "@/lib/free-names";
import { one, withParams } from "@/lib/format";
import { SET_LABELS } from "@/lib/pool";
import { ACTIVE_SETS } from "@/lib/sets";
import { t } from "@/lib/copy/fa";
import { FreePrice, RegisterMenu } from "@/components/register-menu";

export const metadata: Metadata = { title: t.free.title };

const fa = (n: number) => n.toLocaleString("fa-IR");
const chip = (on: boolean) =>
  `press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${on ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink hover:bg-hover"}`;

export default async function FreeNamesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const query = await searchParams;
  const q = parseFreeQuery(query);
  const lengths = freeLengthCounts();
  const res = browseFree(q);
  const params = { len: q.len ?? undefined, set: q.set ?? undefined, q: q.q || undefined };
  const href = (over: Record<string, string | number | undefined>) => withParams("/admin/free", { ...params, ...over, page: undefined });
  const total = lengths.reduce((a, l) => a + l.count, 0);
  const error = one(query.error);
  const imported = one(query.imported);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8" data-testid="free-names">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl sm:text-4xl">
            {t.free.title}
            <span title={t.free.adminOnlyTip}><Badge tone="gold">{t.free.adminOnly}</Badge></span>
          </h1>
          <p className="mt-1 text-sm tabular-nums text-muted">{t.free.count(fa(total))}</p>
        </div>
        <form action={uploadFreeAction} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".csv" required className="max-w-48 text-xs" />
          <input name="tag" placeholder={t.free.tag} dir="ltr" className={`${fieldClass} h-9 w-36 text-sm`} />
          <button className={buttonClass("secondary", "sm")}>{t.free.upload}</button>
        </form>
      </div>

      <div className="mt-3 grid gap-2 empty:hidden">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {imported ? <Alert tone="success">{t.free.imported(fa(Number(imported)), fa(Number(one(query.skipped) ?? 0)))}</Alert> : null}
      </div>

      <div className="mt-4 grid gap-2.5 rounded-xl border border-line bg-card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={href({ len: undefined })} className={chip(q.len == null)}>{t.len.all}</Link>
          {lengths.map((l) => (
            <Link key={l.length} href={href({ len: l.length })} className={chip(q.len === l.length)} title={t.len.roundLength(l.length)}>
              {t.len.letters(l.length)}
              <span className="tabular-nums opacity-70">{fa(l.count)}</span>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={href({ set: undefined })} className={chip(q.set == null)}>{t.len.all}</Link>
          {ACTIVE_SETS.map((n) => (
            <Link key={n} href={href({ set: n })} className={chip(q.set === n)}>{SET_LABELS[n]}</Link>
          ))}
        </div>
        <form action="/admin/free" className="flex gap-2">
          {q.len != null ? <input type="hidden" name="len" value={q.len} /> : null}
          {q.set != null ? <input type="hidden" name="set" value={q.set} /> : null}
          <input name="q" type="search" defaultValue={q.q} placeholder={t.free.search} dir="ltr" className={`${fieldClass} placeholder:text-end`} enterKeyHint="search" />
        </form>
      </div>

      <p className="mt-3 px-1 text-xs tabular-nums text-muted">{fa(res.total)}</p>
      {res.rows.length ? (
        <ul className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {res.rows.map((r) => (
            <li key={r.name} className="pop-in relative flex flex-col gap-2 rounded-xl border border-line bg-card px-3 py-2.5">
              <span dir="ltr" className="min-w-0 truncate pe-6 font-mono text-base font-semibold">
                {r.name.slice(0, r.len)}
                <span className="text-xs font-normal text-muted">.com</span>
              </span>
              <span className="flex items-center justify-between gap-1">
                {r.reg_price_usd != null ? <FreePrice price={r.reg_price_usd} /> : <span />}
                <span className="flex shrink-0 items-center gap-1">
                  {r.inPool ? (
                    <span title={t.free.inPoolTip} className="size-2 rounded-full bg-accent" aria-label={t.free.inPool} />
                  ) : null}
                  {r.shape ? (
                    <span title={t.free.shape} dir="ltr" className="rounded bg-chip px-1 font-mono text-[10px] text-muted">{r.shape}</span>
                  ) : null}
                </span>
              </span>
              <RegisterMenu name={r.name} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-center text-sm text-muted">{t.free.empty}</p>
      )}
      <Pager path="/admin/free" params={params} page={res.page} pages={res.pages} />
    </main>
  );
}
