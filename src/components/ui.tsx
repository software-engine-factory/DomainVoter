import type { ReactNode } from "react";

export function buttonClass(variant: "primary" | "secondary" | "ghost" = "primary", size: "md" | "sm" = "md") {
  const height = size === "sm" ? "h-9 px-3" : "h-11 px-4";
  const base = `inline-flex ${height} items-center justify-center rounded-lg text-sm font-semibold transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100`;
  if (variant === "secondary") return `${base} border border-line bg-card text-ink hover:border-ink/25 hover:bg-paper`;
  if (variant === "ghost") return `${base} text-ink hover:bg-hover`;
  return `${base} bg-accent text-on-accent shadow-sm shadow-accent/20 hover:-translate-y-px hover:bg-accent-strong hover:shadow-md hover:shadow-accent/25`;
}

/** Field look without a width, for inline admin controls that set their own (w-44 etc). */
export const fieldBase =
  "h-11 rounded-lg border border-line bg-card px-3 text-base text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25";

export const fieldClass = `${fieldBase} w-full`;

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-ink">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-sm font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "danger" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "border-line bg-card text-ink",
    danger: "border-danger/30 bg-danger-soft text-danger",
    success: "border-accent/20 bg-accent-soft text-accent",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`pop-in rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "accent" | "gold" | "muted"; children: ReactNode }) {
  const tones = {
    accent: "bg-accent-soft text-accent",
    gold: "bg-gold-soft text-gold",
    muted: "bg-chip text-ink",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums">{new Intl.NumberFormat("fa-IR").format(clamped)}٪</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
