"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { t } from "@/lib/copy/fa";

/**
 * Lightweight admin-only guided tour. One step per admin screen, each spotlighting the
 * nav link (`data-tour="…"`) that leads there. Seen/skipped is stored per admin in localStorage.
 */
type StepId = keyof typeof t.tour.steps;
const STEPS: { id: StepId; anchors: string[] }[] = [
  { id: "rounds", anchors: ["rounds"] },
  { id: "results", anchors: ["results", "rounds"] },
  { id: "newRound", anchors: ["newRound", "batch"] },
  { id: "pool", anchors: ["pool"] },
  { id: "picks", anchors: ["picks"] },
  { id: "bookmarks", anchors: ["bookmarks"] },
  { id: "users", anchors: ["users"] },
  { id: "stats", anchors: ["stats"] },
  { id: "explore", anchors: ["explore"] },
];

const storageKey = (user: string) => `dv-admin-tour:${user}`;
const PAD = 6;

function findAnchor(anchors: string[]): HTMLElement | null {
  for (const a of anchors) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${a}"]`);
    if (el && el.getClientRects().length) return el;
  }
  return null;
}

/** Header icon button; the tour only exists on admin screens. */
export function AdminTour({ user }: { user: string }) {
  const path = usePathname();
  if (!path.startsWith("/admin")) return null;
  return <AdminTourInner user={user} />;
}

function AdminTourInner({ user }: { user: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Auto-start on the first admin visit.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setMounted(true);
      try {
        if (!localStorage.getItem(storageKey(user))) setIndex(0);
      } catch {
        /* storage blocked: never auto-run */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [user]);

  const finish = useCallback(
    (how: "done" | "skipped") => {
      try {
        localStorage.setItem(storageKey(user), how);
      } catch {}
      setIndex(null);
    },
    [user],
  );

  const measure = useCallback(() => {
    if (index === null) return;
    const el = findAnchor(STEPS[index].anchors);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [index]);

  useLayoutEffect(() => {
    if (index === null) return;
    const el = findAnchor(STEPS[index].anchors);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
    const raf = requestAnimationFrame(measure);
    const late = window.setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, measure]);

  useEffect(() => {
    if (index === null) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("skipped");
      // RTL: left arrow moves forward.
      if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : Math.min(i + 1, STEPS.length - 1)));
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, finish]);

  const step = index === null ? null : STEPS[index];
  const copy = step ? t.tour.steps[step.id] : null;
  const last = index === STEPS.length - 1;

  // Desktop: card under the spotlight, clamped to the viewport. Mobile: bottom sheet (CSS).
  let cardStyle: React.CSSProperties | undefined;
  if (rect && typeof window !== "undefined" && window.innerWidth >= 640) {
    const w = 320;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 12);
    cardStyle = { top: rect.bottom + PAD + 10, left, width: w };
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIndex(0)}
        title={t.tour.open}
        aria-label={t.tour.open}
        aria-haspopup="dialog"
        data-tour-open
        className="press group inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-card text-muted transition duration-200 hover:border-accent/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="size-[18px] transition-transform duration-300 group-hover:-rotate-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 3.6" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" />
        </svg>
      </button>
      {mounted && step && copy
        ? createPortal(
            <div className="tour-root fixed inset-0 z-50" role="presentation">
              {/* One flat dimming layer cut out by the spotlight: no blur, no stacked translucency. */}
              <div className="absolute inset-0" onClick={() => finish("skipped")} aria-hidden />
              {rect ? (
                <div
                  aria-hidden
                  className="tour-spot pointer-events-none absolute rounded-xl ring-2 ring-accent"
                  style={{
                    top: rect.top - PAD,
                    left: rect.left - PAD,
                    width: rect.width + PAD * 2,
                    height: rect.height + PAD * 2,
                  }}
                />
              ) : (
                <div aria-hidden className="tour-dim pointer-events-none absolute inset-0" />
              )}
              <div
                key={step.id}
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-label={t.tour.label}
                aria-describedby="tour-body"
                tabIndex={-1}
                style={cardStyle}
                className={`tour-card fixed rounded-2xl border border-line bg-paper p-4 text-ink shadow-xl outline-none ${
                  cardStyle ? "" : "inset-x-3 bottom-3 sm:inset-x-auto sm:start-1/2 sm:top-24 sm:bottom-auto sm:w-80"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-xl leading-tight">{copy.title}</h2>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {t.tour.progress(index! + 1, STEPS.length)}
                  </span>
                </div>
                <p id="tour-body" className="mt-2 text-sm leading-7 text-ink/85">
                  {copy.body}
                </p>
                <div className="mt-2 flex gap-1" aria-hidden>
                  {STEPS.map((s, i) => (
                    <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-accent" : "w-1.5 bg-muted/40"}`} />
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" className={buttonClass("primary", "sm")} onClick={() => (last ? finish("done") : setIndex(index! + 1))}>
                    {last ? t.tour.done : t.tour.next}
                  </button>
                  {index! > 0 ? (
                    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setIndex(index! - 1)}>
                      {t.tour.prev}
                    </button>
                  ) : null}
                  {!last ? (
                    <button type="button" className={`${buttonClass("ghost", "sm")} ms-auto text-muted`} onClick={() => finish("skipped")}>
                      {t.tour.skip}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
