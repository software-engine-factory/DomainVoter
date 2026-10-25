"use client";

import { useState } from "react";
import { clampPage } from "@/lib/vote-view";
import { t } from "@/lib/copy/fa";

/** Prev / "page [n] of N · go" / next. The typed page is clamped into range; bad input is ignored. */
export function Pager({
  page,
  pages,
  onGo,
  mobileArrows = true,
}: {
  page: number;
  pages: number;
  onGo: (page: number) => void;
  /** Off when the grid's own swipe/chunk arrows already page on mobile. */
  mobileArrows?: boolean;
}) {
  // Draft text for the box; null = show the live page number.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(page);

  function submit() {
    const next = clampPage(value, page, pages);
    setDraft(null);
    if (next !== page) onGo(next);
  }

  const arrow = `${mobileArrows ? "" : "max-sm:invisible "}press grid size-9 shrink-0 place-items-center rounded-full border border-line bg-card text-lg leading-none text-ink disabled:opacity-30`;

  return (
    <nav aria-label={t.vote.goToLabel} className="mt-2 flex shrink-0 items-center justify-between gap-2">
      <button type="button" className={arrow} disabled={page <= 1} onClick={() => onGo(page - 1)} aria-label={t.common.prev}>
        ›
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
        <span className="tabular-nums">{t.vote.ofPages(pages)}</span>
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
        ‹
      </button>
    </nav>
  );
}
