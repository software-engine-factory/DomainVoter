import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Alert, Badge, buttonClass, fieldClass } from "@/components/ui";
import { Pager } from "@/components/admin/pager";
import { uploadFreeAction } from "@/lib/actions/free";
import { browseFree, freeLengthCounts, freeShapeCounts, parseFreeQuery, registerLinks, type FreeRow } from "@/lib/free-names";
import { one, withParams } from "@/lib/format";
import { SET_LABELS } from "@/lib/pool";
import { ACTIVE_SETS } from "@/lib/sets";
import { t } from "@/lib/copy/fa";

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
  const shapes = freeShapeCounts(q.len);
  const params = { len: q.len ?? undefined, set: q.set ?? undefined, shape: q.shape ?? undefined, cf: q.cf ? 1 : undefined, q: q.q || undefined };
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
          <Link href={href({ len: undefined, shape: undefined })} className={chip(q.len == null)}>{t.len.all}</Link>
          {lengths.map((l) => (
            <Link key={l.length} href={href({ len: l.length, shape: undefined })} className={chip(q.len === l.length)} title={t.len.roundLength(l.length)}>
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
          <Link href={href({ cf: q.cf ? undefined : 1 })} className={chip(q.cf)} title={t.free.cfOnlyTip} aria-pressed={q.cf}>
            {t.free.cfOnly}
          </Link>
        </div>
        {shapes.length ? (
          <div className="flex flex-wrap items-center gap-1.5" aria-label={t.free.shape}>
            <Link href={href({ shape: undefined })} className={chip(q.shape == null)} title={t.free.shape}>{t.len.all}</Link>
            {shapes.map((sh) => (
              <Link key={sh.shape} href={href({ shape: sh.shape })} className={chip(q.shape === sh.shape)} title={t.free.shape}>
                <span dir="ltr" className="font-mono">{sh.shape}</span>
                <span className="tabular-nums opacity-70">{fa(sh.count)}</span>
              </Link>
            ))}
          </div>
        ) : null}
        <form action="/admin/free" className="flex gap-2">
          {q.len != null ? <input type="hidden" name="len" value={q.len} /> : null}
          {q.set != null ? <input type="hidden" name="set" value={q.set} /> : null}
          {q.shape ? <input type="hidden" name="shape" value={q.shape} /> : null}
          {q.cf ? <input type="hidden" name="cf" value="1" /> : null}
          <input name="q" type="search" defaultValue={q.q} placeholder={t.free.search} dir="ltr" className={`${fieldClass} placeholder:text-end`} enterKeyHint="search" />
        </form>
      </div>

      <p className="mt-3 px-1 text-xs tabular-nums text-muted">{fa(res.total)}</p>
      {res.rows.length ? (
        <ul className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="free-cards">
          {res.rows.map((r, i) => (
            <FreeCard key={r.name} row={r} index={i} />
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-center text-sm text-muted">{t.free.empty}</p>
      )}
      <Pager path="/admin/free" params={params} page={res.page} pages={res.pages} />
    </main>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }) : "");
const linkClass = (primary: boolean) =>
  `press inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded-md border px-1 font-mono text-[11px] font-semibold hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    primary ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-paper text-ink"
  }`;

/** One registerable name, styled like a vote-grid tile, with an at-cost price badge and in-app register links. */
function FreeCard({ row, index }: { row: FreeRow; index: number }) {
  const label = row.name.slice(0, row.len);
  const links = registerLinks(row.name);
  const registrar = t.free.registrars[row.reg_registrar ?? "cloudflare"] ?? row.reg_registrar ?? "Cloudflare";
  return (
    <li className="vote-enter min-w-0" style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}>
      <div className="@container flex h-full flex-col rounded-xl border border-line bg-card px-3 py-2.5">
        <div dir="ltr" className="flex items-start justify-between gap-1">
          <p className="flex min-w-0 items-baseline text-left">
            <span
              className="truncate font-mono leading-none font-semibold tracking-tight text-ink"
              style={{ fontSize: `clamp(1.15rem, ${Math.round(84 / Math.max(label.length, 1))}cqw, 2.15rem)` }}
            >
              {label}
            </span>
            <span className="shrink-0 font-mono text-sm leading-none font-medium text-muted">.com</span>
          </p>
          {row.inPool ? <span title={t.free.inPoolTip} aria-label={t.free.inPool} className="mt-1 size-2 shrink-0 rounded-full bg-accent" /> : null}
        </div>
        <div className="mt-2 flex min-h-6 items-center justify-between gap-1.5">
          {row.cf_free === 0 ? (
            <span title={t.free.takenTip} className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">{t.free.taken}</span>
          ) : row.reg_price_usd != null ? (
            <span
              dir="ltr"
              title={t.free.priceTip(registrar, day(row.cf_checked_at))}
              className="inline-flex items-center gap-1 rounded-md bg-chip px-1.5 py-0.5 font-mono text-xs leading-4 font-semibold tabular-nums text-ink/80"
            >
              <span className="sr-only">{t.free.price}: </span>
              <span className="size-1.5 rounded-full bg-[#f38020]" aria-hidden />
              {usd(row.reg_price_usd)}
            </span>
          ) : (
            <span title={t.free.noPriceTip} className="rounded-md bg-chip px-1.5 py-0.5 text-[11px] text-muted">{t.free.noPrice}</span>
          )}
          {row.shape ? <span title={t.free.shape} dir="ltr" className="truncate font-mono text-[10px] uppercase text-muted">{row.shape}</span> : null}
        </div>
        <div dir="ltr" className="mt-2 flex gap-1" aria-label={t.free.register}>
          {(["cloudflare", "namecheap", "godaddy"] as const).map((k) => (
            <a
              key={k}
              href={links[k]}
              target="_blank"
              rel="noopener noreferrer"
              title={t.free.registerAt(t.free.registrars[k])}
              aria-label={`${t.free.registerAt(t.free.registrars[k])}: ${row.name}`}
              className={linkClass(k === "cloudflare")}
            >
              {k === "cloudflare" ? "CF" : k === "namecheap" ? "NC" : "GD"}
            </a>
          ))}
        </div>
      </div>
    </li>
  );
}
