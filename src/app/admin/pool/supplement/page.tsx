import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Alert, Badge, buttonClass } from "@/components/ui";
import { applySupplementAction, removeSupplementAction } from "@/lib/actions/supplements";
import { importTags, planSupplement } from "@/lib/supplements";
import { one, withParams } from "@/lib/format";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.supp.title };
const fa = (n: number) => n.toLocaleString("fa-IR");

/** Preview of option (b): which gap names each existing round would get, appended after its frozen order. */
export default async function SupplementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const query = await searchParams;
  const tags = importTags();
  const tag = one(query.tag) || tags[0]?.tag || "";
  const plan = tag ? planSupplement(tag) : [];
  const adding = plan.reduce((a, p) => a + p.add.length, 0);
  const appended = plan.reduce((a, p) => a + p.existing, 0);
  const applied = one(query.applied);
  const removed = one(query.removed);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-8" data-testid="supplement">
      <h1 className="font-display text-3xl sm:text-4xl">{t.supp.title}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.length ? (
          tags.map((x) => (
            <Link
              key={x.tag}
              href={withParams("/admin/pool/supplement", { tag: x.tag })}
              className={`press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${x.tag === tag ? "border-accent bg-accent-soft text-accent" : "border-line bg-card"}`}
              title={x.lmin === x.lmax ? t.len.roundLength(x.lmin) : t.len.mixed}
            >
              <span dir="ltr">{x.tag}</span>
              <span className="tabular-nums opacity-70">{fa(x.n)}</span>
            </Link>
          ))
        ) : (
          <p className="text-sm text-muted">{t.supp.noTags}</p>
        )}
      </div>

      <div className="mt-3 grid gap-2 empty:hidden">
        {applied ? <Alert tone="success">{t.supp.applied(fa(Number(applied)), fa(Number(one(query.rounds) ?? 0)))}</Alert> : null}
        {removed ? <Alert tone="success">{t.supp.removed(fa(Number(removed)))}</Alert> : null}
      </div>

      {tag ? (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-2xl tabular-nums" data-testid="supp-total">{t.supp.total(fa(adding))}</p>
            <div className="flex gap-2">
              {appended ? (
                <form action={removeSupplementAction}>
                  <input type="hidden" name="tag" value={tag} />
                  <button className={buttonClass("ghost", "sm")}>{t.supp.undo}</button>
                </form>
              ) : null}
              <form action={applySupplementAction}>
                <input type="hidden" name="tag" value={tag} />
                <button className={buttonClass("primary", "sm")} disabled={!adding}>{t.supp.apply}</button>
              </form>
            </div>
          </div>
          <ul className="mt-3 grid gap-2">
            {plan.map((p) => (
              <li key={p.roundId} className="pop-in rounded-xl border border-line bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/admin/rounds/${p.roundId}`} className="min-w-0 truncate font-semibold hover:text-accent">{p.title}</Link>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                    <span title={t.supp.core}><Badge tone="muted">{fa(p.core)}</Badge></span>
                    {p.add.length ? (
                      <span title={t.supp.add}><Badge tone="gold">{t.supp.badge(p.add.length)}</Badge></span>
                    ) : p.existing ? (
                      <span title={t.supp.skip.done}><Badge tone="accent">{t.supp.badge(p.existing)}</Badge></span>
                    ) : (
                      <span className="text-muted">{t.supp.skip[p.skip ?? "none"]}</span>
                    )}
                  </span>
                </div>
                {p.add.length ? (
                  <p dir="ltr" className="mt-1.5 truncate font-mono text-xs text-muted" title={t.supp.sample}>
                    {p.add.slice(0, 8).map((n) => n.replace(/\.com$/, "")).join(" · ")}
                    {p.add.length > 8 ? " …" : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
