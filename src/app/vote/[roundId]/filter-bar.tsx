"use client";

import { useEffect, useRef, useState } from "react";
import {
  groupDigits,
  normalizePattern,
  normalizeQuery,
  parseGrouped,
  PATTERN_MAX,
  patternActive,
  toDomainChar,
  type VoteView,
} from "@/lib/vote-view";
import { t } from "@/lib/copy/fa";

const DEFAULT_SLOTS = 4;
const MIN_SLOTS = 1;

function slotsFrom(pat: string, exact: boolean) {
  const chars = [...pat].map((ch) => (ch === "_" ? "" : ch));
  const length = exact ? chars.length : Math.max(DEFAULT_SLOTS, chars.length);
  return Array.from({ length: Math.max(length, MIN_SLOTS) }, (_, i) => chars[i] ?? "");
}

const box = "border-line bg-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25";

/** Digit-grouped number box: shows ۵٬۰۰۰, keeps the caret sane by reformatting only on blur. */
function GroupedInput({
  value,
  placeholder,
  label,
  onValue,
}: {
  value: number | null;
  placeholder: string;
  label: string;
  onValue: (n: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? groupDigits(value);
  return (
    <input
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="done"
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const n = parseGrouped(e.target.value);
        // Live grouping while typing; the caret jumps to the end, which is where digits get typed anyway.
        setDraft(n == null ? "" : groupDigits(n));
        onValue(n);
      }}
      onBlur={() => setDraft(null)}
      className="h-8 w-[4.75rem] min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums text-ink outline-none placeholder:font-normal placeholder:text-muted/70"
    />
  );
}

/**
 * One compact filter row: free text · per-position letter slots · position range.
 * Everything applies as you type (debounced) and wraps into rows on narrow screens.
 */
export function FilterBar({
  view,
  total,
  matched,
  onChange,
}: {
  view: VoteView;
  total: number;
  matched: number | null;
  onChange: (patch: Partial<VoteView>) => void;
}) {
  const [text, setText] = useState(view.q);
  const [slots, setSlots] = useState(() => slotsFrom(view.pat, view.exact));
  const [exact, setExact] = useState(view.exact);
  const [from, setFrom] = useState<number | null>(view.from);
  const [to, setTo] = useState<number | null>(view.to);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const q = normalizeQuery(text);
  const pat = normalizePattern(slots.map((s) => s || "_").join(""), exact);
  const effectiveExact = exact && pat.length > 0;
  // Whole-round range collapses to null so it doesn't count as a filter or clutter the URL.
  const rFrom = from == null || from <= 1 ? null : Math.min(from, total);
  const rTo = to == null || to >= total ? null : Math.max(to, 1);
  useEffect(() => {
    if (q === view.q && pat === view.pat && effectiveExact === view.exact && rFrom === view.from && rTo === view.to) return;
    const timer = window.setTimeout(
      () => onChangeRef.current({ q, pat, exact: effectiveExact, from: rFrom, to: rTo }),
      260,
    );
    return () => window.clearTimeout(timer);
  }, [q, pat, effectiveExact, rFrom, rTo, view.q, view.pat, view.exact, view.from, view.to]);

  const posActive = patternActive(pat, effectiveExact);
  const anyActive = q !== "" || posActive || rFrom != null || rTo != null;

  function setSlot(index: number, raw: string) {
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
    setFrom(null);
    setTo(null);
  }

  const step =
    "press grid size-7 shrink-0 place-items-center rounded-md text-base leading-none text-muted hover:bg-chip hover:text-ink disabled:opacity-30";

  return (
    <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1.5">
      {/* Free text */}
      <label className={`relative flex h-10 min-w-0 basis-full items-center rounded-lg border sm:basis-56 sm:flex-1 ${box}`}>
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
          className="h-full w-full bg-transparent ps-9 pe-3 font-mono text-base text-ink outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted"
        />
      </label>

      {/* Per-position letters, inline */}
      <div
        role="group"
        aria-label={t.vote.positionTitle}
        title={t.vote.positionHint}
        className={`flex h-10 min-w-[13rem] flex-[1_1_13rem] items-center gap-0.5 rounded-lg border px-1 sm:max-w-[22rem] sm:flex-none ${posActive ? "border-accent bg-accent-soft/60" : "border-line bg-card"}`}
      >
        <button type="button" aria-label={t.vote.removeSlot} disabled={slots.length <= MIN_SLOTS} onClick={() => resize(-1)} className={step}>
          −
        </button>
        <div dir="ltr" className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-0.5 py-1 [&>*:first-child]:ms-auto [&>*:last-child]:me-auto">
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
              className={`slot-pop h-7 w-7 shrink-0 rounded-md border text-center font-mono text-base font-semibold lowercase text-ink outline-none transition-colors placeholder:text-[10px] placeholder:font-normal placeholder:text-muted/60 focus:border-accent ${
                value ? "border-accent bg-accent-soft" : "border-line/70 bg-paper"
              }`}
            />
          ))}
        </div>
        <button type="button" aria-label={t.vote.addSlot} disabled={slots.length >= PATTERN_MAX} onClick={() => resize(1)} className={step}>
          +
        </button>
        <button
          type="button"
          aria-pressed={exact}
          title={t.vote.exactLength(slots.length)}
          onClick={() => setExact((v) => !v)}
          className={`press ms-0.5 h-6 shrink-0 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold transition-colors ${
            exact ? "border-accent bg-accent text-on-accent" : "border-line text-muted hover:text-ink"
          }`}
        >
          {t.vote.exactChip}
          <span className="sr-only"> — {t.vote.exactLength(slots.length)}</span>
        </button>
      </div>

      {/* Position range */}
      <div
        role="group"
        aria-label={t.vote.rangeLabel}
        className={`flex h-10 flex-1 items-center justify-center gap-1 rounded-lg border px-1 text-xs text-muted sm:flex-none ${
          rFrom != null || rTo != null ? "border-accent bg-accent-soft/60" : box
        }`}
      >
        <span className="ps-1.5">{t.vote.rangeFrom}</span>
        <GroupedInput value={from} placeholder={groupDigits(1)} label={t.vote.rangeFrom} onValue={setFrom} />
        <span>{t.vote.rangeTo}</span>
        <GroupedInput value={to} placeholder={groupDigits(total)} label={t.vote.rangeTo} onValue={setTo} />
      </div>

      {matched != null ? (
        <span aria-live="polite" title={t.vote.matched(matched)} className="pop-in inline-flex h-7 shrink-0 items-center rounded-full bg-chip px-2.5 text-xs font-semibold tabular-nums text-ink">
          {groupDigits(matched)}
          <span className="sr-only"> {t.vote.matched(matched)}</span>
        </span>
      ) : null}
      {anyActive ? (
        <button
          type="button"
          onClick={clearAll}
          aria-label={t.vote.clearAll}
          title={t.vote.clearAll}
          className="press pop-in grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-chip hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
