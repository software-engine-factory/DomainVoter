"use client";

import { useRef, useState } from "react";
import { PATTERN_MAX, toDomainChar } from "@/lib/vote-view";
import { t } from "@/lib/copy/fa";

/**
 * Letter-position slots for a GET form (same idea as the voter grid): writes hidden `pat` ("_" = any)
 * and `exact`. Enter submits the surrounding form.
 */
export function PatternSlots({ pat, exact: initialExact }: { pat: string; exact: boolean }) {
  const [slots, setSlots] = useState(() => {
    const chars = [...pat].map((c) => (c === "_" ? "" : c));
    return Array.from({ length: Math.max(5, chars.length) }, (_, i) => chars[i] ?? "");
  });
  const [exact, setExact] = useState(initialExact);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const value = slots.map((s) => s || "_").join("");
  const active = /[^_]/.test(value);

  function set(index: number, raw: string) {
    const ch = raw === "" ? "" : toDomainChar([...raw].at(-1) ?? "");
    if (raw !== "" && ch === "") return;
    setSlots((cur) => cur.map((s, i) => (i === index ? ch : s)));
    if (ch && index < slots.length - 1) refs.current[index + 1]?.focus();
  }
  const resize = (d: number) =>
    setSlots((cur) => Array.from({ length: Math.min(Math.max(cur.length + d, 1), PATTERN_MAX) }, (_, i) => cur[i] ?? ""));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <input type="hidden" name="pat" value={active ? value : ""} />
      {active && exact ? <input type="hidden" name="exact" value="1" /> : null}
      <div dir="ltr" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {slots.map((v, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={v}
            aria-label={t.vote.slot(i + 1)}
            placeholder={String(i + 1)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !v && i > 0) {
                e.preventDefault();
                set(i - 1, "");
                refs.current[i - 1]?.focus();
              }
            }}
            className={`size-8 shrink-0 rounded-lg sm:size-9 border text-center font-mono text-base font-semibold lowercase text-ink outline-none placeholder:text-[10px] placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ${
              v ? "border-accent bg-accent-soft" : "border-line bg-paper"
            }`}
          />
        ))}
      </div>
      <div dir="ltr" className="flex shrink-0 gap-1">
          <button type="button" aria-label={t.vote.removeSlot} onClick={() => resize(-1)} className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-ink">−</button>
          <button type="button" aria-label={t.vote.addSlot} onClick={() => resize(1)} className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-ink">+</button>
      </div>
      <label className={`inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full border px-2.5 text-xs font-semibold ${exact ? "border-accent bg-accent-soft text-ink" : "border-line text-muted"}`}>
        <input type="checkbox" data-nosubmit className="sr-only" checked={exact} onChange={(e) => setExact(e.target.checked)} />
        {t.browse.exact}
      </label>
    </div>
  );
}
