import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { ACTIVE_SETS } from "@/lib/sets";
import Link from "next/link";
import { InfoTip } from "@/components/admin/info-tip";
import { Alert, buttonClass, fieldClass } from "@/components/ui";
import { syncPoolAction, uploadPoolAction } from "@/lib/actions/pool";
import { formatPrice, formatWhen, one, withParams } from "@/lib/format";
import { defaultImportPath } from "@/lib/paths";
import { recentImports, SET_LABELS } from "@/lib/pool";
import { NONE, poolOverview, setSamples } from "@/lib/pool-browse";
import { SubmitButton } from "@/components/pending";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.nav.pool };

const fa = (n: number | null | undefined) => (n ?? 0).toLocaleString("fa-IR");
const explore = (params: Record<string, string | number | undefined>) => withParams("/admin/explore", params);
const cellLink = "block rounded px-1 py-0.5 tabular-nums hover:bg-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const th = "px-2 py-2 text-end text-xs font-medium text-muted";
const td = "px-1 py-1 text-end";

export default async function PoolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const query = await searchParams;
  const [{ bySet, bySource, byLength, totals, overlap13 }, samples] = await Promise.all([poolOverview(), setSamples()]);
  const imports = recentImports();
  const error = one(query.error);
  const imported = one(query.imported);
  const srcLabel = (key: string) => (key === NONE ? t.overview.noPrice : key === "unknown" ? t.browse.unknownSource : key);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl">{t.pool.title}</h1>
          <p className="mt-1 text-sm tabular-nums text-muted">
            <Link href="/admin/explore" className="hover:text-accent">{t.overview.summary(fa(totals.total), fa(totals.priced))}</Link>
            {totals.lastImport ? t.pool.lastSync(formatWhen(totals.lastImport)) : ""}
          </p>
        </div>
        <Link href="/admin/rounds/new?mode=pool" className={buttonClass("primary", "sm")}>
          {t.pool.createFromPool}
        </Link>
      </div>

      <div className="mt-4 grid gap-3 empty:hidden">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {imported ? (
          <Alert tone="success">
            {t.pool.imported(fa(Number(imported)), Number(one(query.skipped)) ? fa(Number(one(query.skipped))) : null)}
          </Alert>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="rounded-xl border border-line bg-card p-3">
          <h2 className="px-1 font-semibold">{t.overview.bySet}</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-2 py-2 text-start text-xs font-medium text-muted">{t.browse.sets}</th>
                  <th className={th}>{t.overview.total}</th>
                  <th className={th}>{t.overview.only}</th>
                  <th className={th}>{t.overview.priced}</th>
                  <th className={th}>{t.overview.median}</th>
                </tr>
              </thead>
              <tbody>
                {bySet.map((row) => {
                  const n = Number(row.key);
                  return (
                    <tr key={row.key} className="border-b border-line last:border-0">
                      <td className="px-1 py-1">
                        <span className="flex items-center gap-1.5">
                          <Link href={explore({ sets: n })} className={`${cellLink} font-medium`}>{SET_LABELS[n]}</Link>
                          <InfoTip label={SET_LABELS[n]}>
                            <span className="block">{t.poolSets.rule[n]}</span>
                            {samples[n]?.length ? (
                              <span className="mt-1 block text-muted">
                                {t.poolSets.samples}
                                <span dir="ltr" className="font-mono">{samples[n].join(", ")}</span>
                              </span>
                            ) : null}
                            <span className="mt-1 block text-[11px] text-muted" dir="ltr">set_{n}</span>
                          </InfoTip>
                        </span>
                      </td>
                      <td className={td}><Link className={cellLink} href={explore({ sets: n })}>{fa(row.total)}</Link></td>
                      <td className={`${td} tabular-nums text-muted`}>{fa(row.only ?? 0)}</td>
                      <td className={td}><Link className={cellLink} href={explore({ sets: n, hp: "yes" })}>{fa(row.priced)}</Link></td>
                      <td className={`${td} whitespace-nowrap text-muted`} dir="ltr">{row.median != null ? formatPrice(row.median) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-xs text-muted">
            <Link className="hover:text-accent" href={explore({ sets: "1,3", sm: "all" })}>{t.overview.overlapNote(fa(overlap13))}</Link>
          </p>
        </section>
        {byLength.length > 1 ? (
          <section className="rounded-xl border border-line bg-card p-3 lg:col-span-2" data-testid="pool-by-length">
            <h2 className="px-1 font-semibold">{t.len.byLength}</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-2 py-2 text-start text-xs font-medium text-muted">{t.len.picker}</th>
                    <th className={th}>{t.overview.total}</th>
                    <th className={th}>{t.overview.priced}</th>
                    <th className={th}>{t.overview.median}</th>
                  </tr>
                </thead>
                <tbody>
                  {byLength.map((row) => {
                    const n = Number(row.key);
                    return (
                      <tr key={row.key} className="border-b border-line last:border-0">
                        <td className="px-1 py-1"><Link href={explore({ lmin: n, lmax: n })} className={`${cellLink} font-medium`} title={t.len.roundLength(n)}>{t.len.letters(n)}</Link></td>
                        <td className={td}><Link className={cellLink} href={explore({ lmin: n, lmax: n })}>{fa(row.total)}</Link></td>
                        <td className={td}><Link className={cellLink} href={explore({ lmin: n, lmax: n, hp: "yes" })}>{fa(row.priced)}</Link></td>
                        <td className={`${td} whitespace-nowrap text-muted`} dir="ltr">{row.median != null ? formatPrice(row.median) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-line bg-card p-3">
          <h2 className="px-1 font-semibold">{t.overview.bySource}</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-2 py-2 text-start text-xs font-medium text-muted">{t.browse.source}</th>
                  <th className={th}>{t.overview.total}</th>
                  <th className={th}>{t.overview.median}</th>
                  {ACTIVE_SETS.map((n) => (
                    <th key={n} className={`${th} max-w-20 truncate`} title={SET_LABELS[n]}>{SET_LABELS[n]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bySource.map((row) => (
                  <tr key={row.key} className="border-b border-line last:border-0">
                    <td className="px-1 py-1">
                      <Link href={explore({ src: row.key })} dir={row.key === NONE ? undefined : "ltr"} className={`${cellLink} font-medium ${row.key === NONE ? "text-muted" : ""}`}>
                        {srcLabel(row.key)}
                      </Link>
                    </td>
                    <td className={td}><Link className={cellLink} href={explore({ src: row.key })}>{fa(row.total)}</Link></td>
                    <td className={`${td} whitespace-nowrap text-muted`} dir="ltr">{row.median != null ? formatPrice(row.median) : "—"}</td>
                    {row.perSet.map((count, i) => (
                      <td key={i} className={td}>
                        {count ? <Link className={cellLink} href={explore({ src: row.key, sets: ACTIVE_SETS[i] })}>{fa(count)}</Link> : <span className="px-1 text-muted/50">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <details className="mt-6 rounded-xl border border-line bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold">{t.overview.tools}</summary>
        <div className="grid gap-4 border-t border-line p-4 md:grid-cols-2">
          <form action={syncPoolAction} className="grid content-start gap-2">
            <h3 className="flex items-center gap-2 font-semibold">{t.pool.syncTitle}<InfoTip>{t.overview.syncTip}</InfoTip></h3>
            <input name="path" dir="ltr" defaultValue={defaultImportPath()} className={`${fieldClass} font-mono`} />
            <SubmitButton pendingLabel={t.pending.importing} className={`${buttonClass("primary", "sm")} justify-self-start`}>{t.pool.syncButton}</SubmitButton>
          </form>
          <form action={uploadPoolAction} className="grid content-start gap-2">
            <h3 className="flex items-center gap-2 font-semibold">{t.pool.uploadTitle}<InfoTip>{t.overview.uploadTip}</InfoTip></h3>
            <input type="file" name="file" accept=".csv,.db,.sqlite,.sqlite3" className="block w-full text-sm" />
            <SubmitButton pendingLabel={t.pending.importing} className={`${buttonClass("secondary", "sm")} justify-self-start`}>{t.pool.uploadButton}</SubmitButton>
          </form>
        </div>
        {imports.length ? (
          <div className="overflow-x-auto border-t border-line p-4">
            <h3 className="font-semibold">{t.pool.recent}</h3>
            <table className="mt-2 w-full min-w-[520px] text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-1.5 text-start text-xs font-medium">{t.pool.col.source}</th>
                  <th className="px-2 py-1.5 text-start text-xs font-medium">{t.pool.col.time}</th>
                  <th className={th}>{t.pool.col.read}</th>
                  <th className={th}>{t.pool.col.upserted}</th>
                  <th className={th}>{t.pool.col.rejected}</th>
                  <th className={th}>{t.pool.col.duration}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td dir="ltr" className="px-2 py-1.5 text-start font-mono text-xs">{row.source}</td>
                    <td className="px-2 py-1.5 text-xs">{formatWhen(row.started_at)}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">{fa(row.rows_read)}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">{fa(row.rows_upserted)}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">{fa(row.rows_skipped)}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">
                      {row.error ? <span className="text-red-700">{t.common.error}</span> : row.finished_at ? `${((row.finished_at - row.started_at) / 1000).toFixed(1)}s` : "…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>
    </main>
  );
}
