import type { ReactNode } from "react";

/** Small ⓘ that reveals a short note on hover or keyboard focus (tap focuses it on mobile). */
export function InfoTip({ children, label = "توضیح", align = "start" }: { children: ReactNode; label?: string; align?: "start" | "end" }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="grid size-5 place-items-center rounded-full text-[11px] font-semibold leading-none text-muted ring-1 ring-line transition hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-accent"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none hidden absolute top-full z-30 mt-1.5 w-64 max-w-[80vw] rounded-lg border border-line bg-card p-2.5 text-start text-xs font-normal leading-5 text-ink shadow-lg group-hover:block group-focus-within:block ${
          align === "end" ? "end-0" : "start-0"
        }`}
      >
        {children}
      </span>
    </span>
  );
}
