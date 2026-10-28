"use client";

import { t } from "@/lib/copy/fa";

export type AvailCounts = { any: number; sale: number; free: number };

/** Segmented "all / for sale / registrable only" control; posts `avail`. */
export function AvailPicker({ counts, value, onChange }: { counts?: AvailCounts; value?: string; onChange?: (v: "any" | "sale" | "free") => void }) {
  const options = [
    ["any", t.avail.any],
    ["sale", t.avail.sale],
    ["free", t.avail.free],
  ] as const;
  return (
    <fieldset className="grid gap-2" data-testid="avail-picker">
      <legend className="mb-2 text-sm font-semibold">{t.avail.label}</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-card p-1">
        {options.map(([v, label]) => (
          <label
            key={v}
            className="press grid cursor-pointer justify-items-center gap-0.5 rounded-lg px-2 py-2 text-center text-sm has-[:checked]:bg-accent-soft has-[:checked]:font-semibold has-[:checked]:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
          >
            <input
              type="radio"
              name="avail"
              value={v}
              className="sr-only"
              {...(value !== undefined ? { checked: value === v, onChange: () => onChange?.(v) } : { defaultChecked: v === "any" })}
            />
            <span className="whitespace-nowrap">{label}</span>
            {counts ? <span className="text-xs tabular-nums text-muted">{counts[v].toLocaleString("fa-IR")}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Per-length availability counts from poolLengthCounts rows (`free` = registrable share). */
export function availCounts(lengths: Array<{ length: number; count: number; free?: number }>, length: number | null): AvailCounts {
  const rows = length == null ? lengths : lengths.filter((l) => l.length === length);
  const any = rows.reduce((a, l) => a + l.count, 0);
  const free = rows.reduce((a, l) => a + (l.free ?? 0), 0);
  return { any, sale: any - free, free };
}
