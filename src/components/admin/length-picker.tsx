"use client";

import { useState } from "react";
import { t } from "@/lib/copy/fa";

export type LengthOption = { length: number; count: number };

/**
 * Segmented 3 / 4 / 5 picker. One length per round (no mixed rounds), so it is a required radio.
 * Each pill shows the letters as dots, so the length reads at a glance without a helper line.
 */
export function LengthPicker({ options, initial, onPick }: { options: LengthOption[]; initial: number | null; onPick?: (n: number) => void }) {
  const [value, setValue] = useState(initial);
  if (!options.length) return null;
  return (
    <fieldset className="grid gap-2" data-testid="length-picker">
      <legend className="mb-2 text-sm font-semibold">{t.len.picker}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <label
            key={o.length}
            title={t.len.roundLength(o.length)}
            className="press relative grid cursor-pointer justify-items-center gap-1.5 rounded-xl border border-line bg-card px-2 py-3 text-center has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
          >
            <input
              type="radio"
              name="length"
              value={o.length}
              required
              checked={value === o.length}
              onChange={() => {
                setValue(o.length);
                onPick?.(o.length);
              }}
              className="sr-only"
            />
            <span dir="ltr" className="flex gap-1" aria-hidden>
              {Array.from({ length: o.length }, (_, i) => (
                <span
                  key={i}
                  className={`size-1.5 rounded-full transition-all duration-300 ${value === o.length ? "scale-110 bg-accent" : "bg-line"}`}
                  style={{ transitionDelay: value === o.length ? `${i * 35}ms` : "0ms" }}
                />
              ))}
            </span>
            <span className="font-display text-lg leading-none">{t.len.letters(o.length)}</span>
            <span className="text-xs tabular-nums text-muted">{o.count.toLocaleString("fa-IR")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
