"use client";

import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/lib/copy/fa";
import { registerLinks } from "@/lib/register-links";

const ICON = "M9 3h4v4M13 3 7.5 8.5M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5";

/**
 * The tile's external-link icon for a free-to-register name: tapping it opens a small popover with
 * the registrars; each option opens in a new tab. Closes on outside tap, Escape, or after picking.
 */
export function RegisterMenu({ name, className = "" }: { name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className={`absolute top-1 start-1 z-20 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t.free.registerMenu(name)}
        title={t.free.registerMenu(name)}
        onClick={() => setOpen((v) => !v)}
        className={`sale-link press grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? "bg-chip text-ink" : "text-muted hover:bg-chip hover:text-ink"
        }`}
      >
        <svg viewBox="0 0 16 16" className={`size-3.5 transition-transform duration-200 ${open ? "-rotate-12 scale-110" : ""}`} aria-hidden>
          <path d={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        id={id}
        role="menu"
        data-open={open}
        className="register-pop absolute top-8 start-0 w-40 origin-top-right overflow-hidden rounded-xl border border-line bg-card p-1 shadow-lg ltr:origin-top-left"
      >
        {registerLinks(name).map((l, i) => (
          <a
            key={l.key}
            role="menuitem"
            dir="ltr"
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={open ? 0 : -1}
            title={t.free.registerAt(l.label)}
            onClick={() => setOpen(false)}
            style={{ transitionDelay: open ? `${40 + i * 35}ms` : "0ms" }}
            className="register-opt press flex h-10 items-center justify-between gap-2 rounded-lg px-2.5 font-mono text-[13px] font-semibold text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
          >
            {l.label}
            <svg viewBox="0 0 16 16" className="size-3 text-muted" aria-hidden>
              <path d={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Registration price + red "not registered yet" dot; the meaning lives in the tooltip. */
export function FreePrice({ price }: { price: number }) {
  const tip = t.free.freeTip(`$${price.toFixed(2)}`);
  return (
    <span
      dir="ltr"
      title={tip}
      className="inline-flex items-center gap-1.5 truncate rounded-md bg-chip px-1.5 py-0.5 font-mono text-xs leading-4 font-semibold tabular-nums text-ink/80"
    >
      <span className="sr-only">{tip}</span>
      <span className="free-dot relative size-2 shrink-0 rounded-full bg-danger" aria-hidden />
      ${price.toFixed(2)}
    </span>
  );
}
