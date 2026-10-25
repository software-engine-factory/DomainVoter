import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, buttonClass, fieldBase } from "@/components/ui";
import { openNextBatchRoundAction } from "@/lib/actions/batches";
import { batchRounds, getBatch, planBatch } from "@/lib/batches";
import { formatPercent, formatWhen, one } from "@/lib/format";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.batch.detailTitle };

const ORDER_LABELS: Record<string, string> = t.batch.orders;

export default async function BatchDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const batch = getBatch(Number((await params).id));
  if (!batch) notFound();
  const created = one((await searchParams).created);
  const plan = planBatch({ total: batch.blockTotal, rounds: batch.roundsPlanned, perRound: batch.perRound, remainderMode: batch.remainderMode });
  const rounds = batchRounds(batch.id);
  const left = plan.sizes.length - rounds.length;
  const usedNames = plan.sizes.slice(0, rounds.length).reduce((a, b) => a + b, 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <Link href="/admin/rounds/batch" className="text-sm text-muted">{t.batch.back}</Link>
      <h1 className="mt-1 font-display text-3xl">{batch.title}</h1>
      <p className="text-xs text-muted">
        {formatWhen(batch.createdAt)} · {t.batch.orderLabel} {ORDER_LABELS[batch.orderMode] ?? batch.orderMode}
        {batch.seed ? <> · {t.batch.seedLabel} <span dir="ltr">{batch.seed}</span></> : null}
      </p>
      {created ? <div className="mt-3"><Alert tone="success">{t.batch.created(Number(created))}</Alert></div> : null}

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-card p-3"><dt className="text-xs text-muted">{t.batch.statBlock}</dt><dd className="text-xl font-semibold tabular-nums">{batch.blockTotal}</dd></div>
        <div className="rounded-xl border border-line bg-card p-3"><dt className="text-xs text-muted">{t.batch.statRounds}</dt><dd className="text-xl font-semibold tabular-nums">{rounds.length} / {plan.sizes.length}</dd></div>
        <div className="rounded-xl border border-line bg-card p-3"><dt className="text-xs text-muted">{t.batch.statLeft}</dt><dd className="text-xl font-semibold tabular-nums">{plan.placed - usedNames}</dd></div>
        <div className="rounded-xl border border-line bg-card p-3"><dt className="text-xs text-muted">{t.batch.statDropped}</dt><dd className="text-xl font-semibold tabular-nums">{batch.remainderMode === "drop" ? plan.remainder : 0}</dd></div>
      </dl>

      {left > 0 ? (
        <form action={openNextBatchRoundAction} className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="batchId" value={batch.id} />
          <span>{t.batch.make}</span>
          <input name="count" type="number" min={1} max={left} defaultValue={1} className={`${fieldBase} h-9 w-20`} dir="ltr" />
          <span>{t.batch.nextRound(plan.sizes[rounds.length])}</span>
          <button className={buttonClass("primary", "sm")}>{t.batch.build}</button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted">{t.batch.allBuilt}</p>
      )}

      <ol className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
        {plan.sizes.map((size, i) => {
          const round = rounds[i];
          return (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
              <span>
                {i + 1}. {round ? <Link className="underline underline-offset-4" href={`/admin/rounds/${round.id}`}>{round.title}</Link> : <span className="text-muted">{t.batch.notYet}</span>}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {t.batch.names(size)}
                {round ? <>{t.batch.roundStats(formatPercent(round.viewed, round.size), round.votes)} <Badge tone={round.status === "open" ? "accent" : "muted"}>{round.status}</Badge></> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
