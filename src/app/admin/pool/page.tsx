import type { Metadata } from "next";
import Link from "next/link";
import { Alert, buttonClass, fieldClass } from "@/components/ui";
import { syncPoolAction, uploadPoolAction } from "@/lib/actions/pool";
import { formatWhen, one } from "@/lib/format";
import { defaultImportPath } from "@/lib/paths";
import { poolFacets, recentImports, SET_LABELS, type PoolFacet } from "@/lib/pool";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.nav.pool };

const fa = (n: number | null | undefined) => (n ?? 0).toLocaleString("fa-IR");

function FacetTable({ title, rows }: { title: string; rows: PoolFacet[] }) {
  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-3 max-h-72 divide-y divide-line overflow-auto text-sm">
        {rows.map((row) => (
          <li key={row.value ?? "__none__"} className="flex items-center justify-between gap-3 py-1.5">
            <span dir="ltr" className="font-mono">{row.value ?? "—"}</span>
            <span className="tabular-nums text-muted">
              {fa(row.count)} <span className="text-xs">{t.pool.priced(fa(row.priced))}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function PoolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { totals, classes, providers, evidence } = poolFacets();
  const imports = recentImports();
  const error = one(query.error);
  const imported = one(query.imported);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">{t.pool.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {t.pool.totals(fa(totals.total), fa(totals.priced), fa(totals.pricedUsd))}
            {totals.lastImport ? t.pool.lastSync(formatWhen(totals.lastImport)) : ""}
          </p>
        </div>
        <Link href="/admin/rounds/new?mode=pool" className={buttonClass()}>
          {t.pool.createFromPool}
        </Link>
      </div>

      <div className="mt-6 grid gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {imported ? (
          <Alert tone="success">
            {t.pool.imported(fa(Number(imported)), Number(one(query.skipped)) ? fa(Number(one(query.skipped))) : null)}
          </Alert>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <form action={syncPoolAction} className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl">{t.pool.syncTitle}</h2>
          <p className="mt-1 text-sm text-muted">
            {t.pool.syncHintA}<span dir="ltr" className="font-mono">/app/data</span>{t.pool.syncHintB}
          </p>
          <input name="path" dir="ltr" defaultValue={defaultImportPath()} className={`${fieldClass} mt-4 font-mono`} />
          <button className={`${buttonClass()} mt-4`}>{t.pool.syncButton}</button>
        </form>
        <form action={uploadPoolAction} className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl">{t.pool.uploadTitle}</h2>
          <p className="mt-1 text-sm text-muted">{t.pool.uploadHint}</p>
          <input type="file" name="file" accept=".csv,.db,.sqlite,.sqlite3" className="mt-4 block w-full text-sm" />
          <button className={`${buttonClass("secondary")} mt-4`}>{t.pool.uploadButton}</button>
        </form>
      </div>

      <section className="mt-6 rounded-xl border border-line bg-card p-4">
        <h3 className="font-semibold">{t.pool.sets}</h3>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n}>
              <span dir="ltr" className="font-mono">set_{n}</span> {SET_LABELS[n]}:{" "}
              <span className="tabular-nums text-muted">{fa(totals[`s${n}` as "s1"])}</span>
            </span>
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <FacetTable title={t.pool.facetProvider} rows={providers} />
        <FacetTable title={t.pool.facetClass} rows={classes} />
        <FacetTable title={t.pool.facetEvidence} rows={evidence} />
      </div>

      <section className="mt-6">
        <h2 className="font-display text-2xl">{t.pool.recent}</h2>
        {imports.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t.pool.recentEmpty}</p>
        ) : (
          <table className="mt-3 w-full border-collapse overflow-hidden rounded-xl border border-line text-sm">
            <thead className="bg-card text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t.pool.col.source}</th>
                <th className="px-3 py-2 text-start font-medium">{t.pool.col.time}</th>
                <th className="px-3 py-2 text-end font-medium">{t.pool.col.read}</th>
                <th className="px-3 py-2 text-end font-medium">{t.pool.col.upserted}</th>
                <th className="px-3 py-2 text-end font-medium">{t.pool.col.rejected}</th>
                <th className="px-3 py-2 text-end font-medium">{t.pool.col.duration}</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td dir="ltr" className="px-3 py-2 text-start font-mono text-xs">{row.source}</td>
                  <td className="px-3 py-2">{formatWhen(row.started_at)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{fa(row.rows_read)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{fa(row.rows_upserted)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{fa(row.rows_skipped)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {row.error ? <span className="text-red-700">{t.common.error}</span> : row.finished_at ? `${((row.finished_at - row.started_at) / 1000).toFixed(1)}s` : "…"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
