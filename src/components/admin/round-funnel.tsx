"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { FunnelStep } from "@/lib/rounds";
import { t } from "@/lib/copy/fa";

/** Round 1 · N → Round 2 · M → …  Scrolls sideways on mobile; the current round is highlighted. */
export function RoundFunnel({ steps, current }: { steps: FunnelStep[]; current: number }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    // Bring the current step fully into view (scrolls only the funnel, not the page).
    const box = nav.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < b.left) box.scrollLeft -= b.left - r.left + 16;
    else if (r.right > b.right) box.scrollLeft += r.right - b.right + 16;
  }, [current]);
  if (steps.length < 2) return null;
  const top = Math.max(...steps.map((s) => s.count), 1);
  return (
    <nav ref={nav} aria-label={t.w4.funnel} data-testid="round-funnel" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ol className="flex min-w-max items-stretch gap-1">
        {steps.map((step, i) => {
          const active = step.id === current;
          return (
            <li key={step.id} className="flex items-center gap-1">
              {i > 0 ? (
                <span className="flex flex-col items-center px-0.5 text-[11px] leading-tight text-muted" data-testid="funnel-rule">
                  <span aria-hidden>←</span>
                  {step.rule ? <span className="whitespace-nowrap">{t.w4.funnelRule(step.rule.mode, step.rule.n)}</span> : null}
                </span>
              ) : null}
              <Link
                href={`/admin/rounds/${step.id}`}
                aria-current={active ? "page" : undefined}
                className={`press block w-[6.5rem] rounded-xl border px-2.5 py-2 sm:w-36 sm:px-3 transition ${
                  active ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-ink/25"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span className={`size-1.5 rounded-full ${step.status === "open" ? "bg-accent" : "bg-muted/50"}`} aria-hidden />
                  {(i + 1).toLocaleString("fa-IR")}
                  {step.children > 1 ? <span className="ms-auto">{t.w4.funnelBranches(step.children)}</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold">{step.title}</span>
                <span className="mt-1 block font-display text-lg sm:text-xl tabular-nums">{step.count.toLocaleString("fa-IR")}</span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line" aria-hidden>
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (step.count / top) * 100)}%` }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
