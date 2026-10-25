"use client";

import { useState } from "react";
import { clampPage, groupDigits, parseGrouped } from "@/lib/vote-view";
import { t } from "@/lib/copy/fa";

/** Prev / "page [n] of N · go" / next. The typed page is clamped into range; bad input is ignored. */
// Explicit geometry (not ‹ › glyphs, which the bidi algorithm mirrors in RTL).
// RTL reading order: "previous" sits on the right and points right, "next" on the left and points left.
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <path d={dir === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Pager({ page, pages, voted, onGo }: { page: number; pages: number; voted: number; onGo: (page: number) => void }) {
  // Draft text for the box; null = show the live page number.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? groupDigits(page);

  function submit() {
    const typed = parseGrouped(value);
    const next = typed == null ? page : clampPage(String(typed), page, pages);
    setDraft(null);
    if (next !== page) onGo(next);
  }

  const arrow = `press grid size-9 shrink-0 place-items-center rounded-full border border-line bg-card text-lg leading-none text-ink disabled:opacity-30`;

  return (
    <nav aria-label={t.vote.goToLabel} className="mt-2 flex shrink-0 items-center justify-between gap-2">
      <button type="button" className={arrow} disabled={page <= 1} onClick={() => onGo(page - 1)} aria-label={t.common.prev}>
        <Chevron dir="right" />
      </button>
      <form
        className="flex items-center gap-1.5 text-sm text-muted"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="goto-page">{t.vote.pageWord}</label>
        <input
          id="goto-page"
          dir="ltr"
          inputMode="numeric"
          enterKeyHint="go"
          autoComplete="off"
          aria-label={t.vote.goToLabel}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value.slice(0, 7))}
          onBlur={() => setDraft(null)}
          className="h-9 w-14 rounded-lg border border-line bg-card px-1 text-center text-base font-semibold tabular-nums text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
        <span className="tabular-nums">{t.vote.ofPages(groupDigits(pages))}</span>
        {voted > 0 ? (
          <span title={t.vote.votedChip(voted)} className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2 text-xs font-semibold tabular-nums text-accent">
            <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
              <path d="M3.5 8.2 6.4 11l6.1-6.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {groupDigits(voted)}
            <span className="sr-only"> {t.vote.votedChip(voted)}</span>
          </span>
        ) : null}
        <button
          type="submit"
          // Keep the click from blurring (and resetting) the box before submit reads it.
          onMouseDown={(event) => event.preventDefault()}
          disabled={pages <= 1}
          className="press h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-40"
        >
          {t.vote.goTo}
        </button>
      </form>
      <button type="button" className={arrow} disabled={page >= pages} onClick={() => onGo(page + 1)} aria-label={t.common.next}>
        <Chevron dir="left" />
      </button>
    </nav>
  );
}
