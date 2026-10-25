"use client";

import { useEffect, useRef, useState } from "react";
import {
  normalizePattern,
  normalizeQuery,
  PATTERN_MAX,
  patternActive,
  toDomainChar,
  type VoteView,
} from "@/lib/vote-view";
import { t } from "@/lib/copy/fa";

const DEFAULT_SLOTS = 5;
const MIN_SLOTS = 1;

function slotsFrom(pat: string, exact: boolean) {
  const chars = [...pat].map((ch) => (ch === "_" ? "" : ch));
  const length = exact ? chars.length : Math.max(DEFAULT_SLOTS, chars.length);
  return Array.from({ length: Math.max(length, MIN_SLOTS) }, (_, i) => chars[i] ?? "");
}

/** Search box and per-position letter slots. Filters apply as you type (debounced). */
export function FilterBar({ view, onChange }: { view: VoteView; onChange: (patch: Partial<VoteView>) => void }) {
  const [text, setText] = useState(view.q);
  const [open, setOpen] = useState(() => patternActive(view.pat, view.exact));
  const [slots, setSlots] = useState(() => slotsFrom(view.pat, view.exact));
  const [exact, setExact] = useState(view.exact);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Push local edits to the view after a short pause, only when they actually change it.
  const q = normalizeQuery(text);
  const pat = normalizePattern(slots.map((s) => s || "_").join(""), exact);
  const effectiveExact = exact && pat.length > 0;
  useEffect(() => {
    if (q === view.q && pat === view.pat && effectiveExact === view.exact) return;
    const timer = window.setTimeout(() => onChangeRef.current({ q, pat, exact: effectiveExact }), 220);
    return () => window.clearTimeout(timer);
  }, [q, pat, effectiveExact, view.q, view.pat, view.exact]);

  const active = patternActive(pat, effectiveExact);

  function setSlot(index: number, raw: string) {
    // Take the last typed char (the box may already hold one), mapped from a Persian layout if needed.
    const ch = raw === "" ? "" : toDomainChar([...raw].at(-1) ?? "");
    if (raw !== "" && ch === "") return;
    setSlots((current) => current.map((s, i) => (i === index ? ch : s)));
    if (ch && index < slots.length - 1) refs.current[index + 1]?.focus();
  }

  function resize(delta: number) {
    setSlots((current) => {
      const n = Math.min(Math.max(current.length + delta, MIN_SLOTS), PATTERN_MAX);
      return Array.from({ length: n }, (_, i) => current[i] ?? "");
    });
  }

  function clearAll() {
    setText("");
    setSlots(slotsFrom("", false));
    setExact(false);
  }

  return (
    <div className="mt-2 shrink-0">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t.vote.searchLabel}</span>
          <svg viewBox="0 0 20 20" aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted">
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            dir={text ? "ltr" : "rtl"}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t.vote.searchPlaceholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            className="h-10 w-full rounded-lg border border-line bg-card ps-9 pe-3 font-mono text-base text-ink outline-none placeholder:font-sans placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </label>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="position-search"
          onClick={() => setOpen((v) => !v)}
          className={`press relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${
            open || active ? "border-accent bg-accent-soft text-ink" : "border-line bg-card text-ink"
          }`}
        >
          <span dir="ltr" className="font-mono text-xs tracking-widest text-muted">_a_</span>
          <span className="max-sm:sr-only">{t.vote.positionToggle}</span>
          {active ? <span className="absolute -top-1 -end-1 size-2.5 rounded-full bg-accent" aria-hidden /> : null}
        </button>
      </div>

      {open ? (
        <div id="position-search" className="pop-in mt-2 rounded-xl border border-line bg-card p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink">{t.vote.positionTitle}</p>
            {active || q ? (
              <button type="button" onClick={clearAll} className="text-xs font-semibold text-accent underline-offset-4 hover:underline">
                {t.vote.clearFilters}
              </button>
            ) : null}
          </div>
          <div dir="ltr" className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
            {slots.map((value, index) => (
              <input
                key={index}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                value={value}
                aria-label={t.vote.slot(index + 1)}
                placeholder={String(index + 1)}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setSlot(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !value && index > 0) {
                    event.preventDefault();
                    setSlot(index - 1, "");
                    refs.current[index - 1]?.focus();
                  } else if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
                  else if (event.key === "ArrowRight" && index < slots.length - 1) refs.current[index + 1]?.focus();
                }}
                className={`size-10 shrink-0 rounded-lg border text-center font-mono text-lg font-semibold lowercase text-ink outline-none transition placeholder:text-xs placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ${
                  value ? "border-accent bg-accent-soft" : "border-line bg-paper"
                }`}
              />
            ))}
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label={t.vote.removeSlot}
                disabled={slots.length <= MIN_SLOTS}
                onClick={() => resize(-1)}
                className="press grid size-8 place-items-center rounded-full border border-line bg-paper text-ink disabled:opacity-30"
              >
                −
              </button>
              <button
                type="button"
                aria-label={t.vote.addSlot}
                disabled={slots.length >= PATTERN_MAX}
                onClick={() => resize(1)}
                className="press grid size-8 place-items-center rounded-full border border-line bg-paper text-ink disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-ink">
              <input
                type="checkbox"
                checked={exact}
                onChange={(event) => setExact(event.target.checked)}
                className="size-4 accent-accent"
              />
              {t.vote.exactLength(slots.length)}
            </label>
            <p className="text-[11px] leading-5 text-muted">{t.vote.positionHint}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
