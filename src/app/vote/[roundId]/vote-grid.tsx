"use client";

import { useRef, useState } from "react";
import { useToggleVote } from "@/lib/query/hooks";
import { t } from "@/lib/copy/fa";

// Mobile packs the 20-card page into one-screen chunks of 8 (CSS-driven, so SSR is correct too).
const MOBILE_CHUNK = 8;
const MOBILE_PAGED_MAX = 20;

type Card = {
  id: number;
  name: string;
  price: number | null;
  currency: string | null;
};

/** Compact price for a tile: "$1,200" / "€80" / "1.5K USD"-style; null when the pool has none. */
function tilePrice(price: number | null, currency: string | null) {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      notation: price >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: price >= 100 ? 0 : 2,
    }).format(price);
  } catch {
    // Unknown currency code: plain number plus the code.
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(price)} ${code}`;
  }
}

function splitDomain(name: string) {
  const dot = name.indexOf(".");
  if (dot <= 0) return { label: name, suffix: "" };
  return { label: name.slice(0, dot), suffix: name.slice(dot) };
}

export function VoteGrid({
  roundId,
  viewKey,
  size,
  ready,
  cards,
  votedIds,
  count,
  onPrev,
  onNext,
  startAtEnd = false,
}: {
  roundId: number;
  viewKey: string;
  size: number;
  /** False while a placeholder (previous view) is shown: tiles can't be toggled yet. */
  ready: boolean;
  cards: Card[];
  votedIds: number[];
  count: number;
  onPrev?: () => void;
  onNext?: () => void;
  startAtEnd?: boolean;
}) {
  const voted = new Set(votedIds);
  const mutation = useToggleVote(
    roundId,
    viewKey,
    cards.map((card) => card.id),
  );
  const pending = mutation.isPending || !ready;
  // 20 per page packs into one-screen swipe chunks on mobile; bigger pages are a plain scroll list.
  const chunked = size <= MOBILE_PAGED_MAX;
  const error = mutation.error?.message ?? "";
  const chunkCount = chunked ? Math.max(1, Math.ceil(cards.length / MOBILE_CHUNK)) : 1;
  const [chunk, setChunk] = useState(() => (startAtEnd ? chunkCount - 1 : 0));
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const touchX = useRef<number | null>(null);
  const [moved, setMoved] = useState(false);
  const activeChunk = Math.min(chunk, chunkCount - 1);

  function goChunk(next: number) {
    // Past either end of this page: move to the neighbouring page (client-side, cached).
    if (next < 0) return void onPrev?.();
    if (next >= chunkCount) return void onNext?.();
    if (next === activeChunk) return;
    setDirection(next > activeChunk ? "next" : "prev");
    setChunk(next);
    setMoved(true);
  }

  function onToggle(id: number) {
    if (pending) return;
    mutation.mutate(id);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-baseline justify-between gap-3 text-sm empty:hidden">
        <p className="hidden text-muted sm:block">
          {t.vote.votedPrefix}{" "}
          <span className="font-semibold tabular-nums text-ink">{count}</span>{" "}
          {t.vote.votedSuffix}
        </p>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <ul
        key={`c${activeChunk}`}
        onTouchStart={(event) => (touchX.current = chunked ? event.touches[0].clientX : null)}
        onTouchEnd={(event) => {
          if (touchX.current == null) return;
          const dx = event.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          // RTL: swiping right moves forward
          if (Math.abs(dx) > 50) goChunk(activeChunk + (dx > 0 ? 1 : -1));
        }}
        className={`grid min-h-0 flex-1 gap-2 p-1 ${
          chunked
            ? "grid-cols-2 grid-rows-4 sm:grid-cols-4 sm:grid-rows-5"
            : "auto-rows-[5.75rem] grid-cols-2 content-start overflow-y-auto overscroll-contain sm:auto-rows-[6.5rem] sm:grid-cols-4 lg:grid-cols-5"
        } ${moved ? (direction === "next" ? "slide-next" : "slide-prev") : ""}`}
      >
        {cards.map((card, index) => {
          const inChunk = Math.floor(index / MOBILE_CHUNK) === activeChunk;
          const selected = voted.has(card.id);
          const domain = splitDomain(card.name);
          const price = tilePrice(card.price, card.currency);
          return (
            <li
              key={card.id}
              className={`vote-enter min-h-0 ${inChunk || !chunked ? "" : "max-sm:hidden"}`}
              style={{ animationDelay: `${Math.min(chunked ? index % MOBILE_CHUNK : index, 12) * 28}ms` }}
            >
              <button
                type="button"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => onToggle(card.id)}
                className={`vote-tile @container flex h-full w-full flex-col overflow-hidden rounded-xl border px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-100 ${
                  selected
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-card hover:border-accent/40"
                }`}
              >
                <span
                  dir="ltr"
                  className="flex min-h-0 w-full flex-1 items-center justify-start text-left"
                >
                  <span className="flex min-w-0 items-baseline">
                    <span
                      className="truncate font-mono leading-none font-semibold tracking-tight text-ink"
                      style={{
                        fontSize: `clamp(1.15rem, ${Math.round(84 / Math.max(domain.label.length, 1))}cqw, 2.15rem)`,
                      }}
                    >
                      {domain.label}
                    </span>
                    {domain.suffix ? (
                      <span className="shrink-0 font-mono text-sm leading-none font-medium text-muted">
                        {domain.suffix}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="mt-auto flex min-h-6 items-end justify-between gap-2 pt-2">
                  {price ? (
                    <span
                      dir="ltr"
                      className="truncate rounded-md bg-chip px-1.5 py-0.5 font-mono text-xs leading-4 font-semibold tabular-nums text-ink/80"
                    >
                      <span className="sr-only">{t.vote.priceLabel}: </span>
                      {price}
                    </span>
                  ) : (
                    <span aria-hidden />
                  )}
                  {selected ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
                      <svg
                        viewBox="0 0 16 16"
                        className="vote-mark size-3.5"
                        aria-hidden
                      >
                        <path
                          d="M3.5 8.2 6.4 11l6.1-6.2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {t.vote.voted}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {chunked && (chunkCount > 1 || onPrev || onNext) ? (
        <div
          className="flex shrink-0 items-center justify-center gap-3 pt-2 sm:hidden"
          dir="ltr"
        >
          <button
            type="button"
            aria-label={t.vote.prevGroup}
            onClick={() => goChunk(activeChunk - 1)}
            disabled={activeChunk === 0 && !onPrev}
            className="press grid size-9 place-items-center rounded-full border border-line bg-card text-ink disabled:opacity-30"
          >
            ‹
          </button>
          <div className="flex items-center gap-1.5" role="tablist">
            {Array.from({ length: chunkCount }, (_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === activeChunk}
                aria-label={String(i + 1)}
                onClick={() => goChunk(i)}
                className={`h-2 min-h-0! shrink-0 rounded-full transition-all duration-300 ${i === activeChunk ? "w-5 bg-accent" : "w-2 bg-muted/40"}`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label={t.vote.nextGroup}
            onClick={() => goChunk(activeChunk + 1)}
            disabled={activeChunk === chunkCount - 1 && !onNext}
            className="press grid size-9 place-items-center rounded-full border border-line bg-card text-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
