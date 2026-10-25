"use client";

import { useToggleVote } from "@/lib/query/hooks";
import { t } from "@/lib/copy/fa";

const DESKTOP_FIT_MAX = 20;

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
}: {
  roundId: number;
  viewKey: string;
  size: number;
  /** False while a placeholder (previous view) is shown: tiles can't be toggled yet. */
  ready: boolean;
  cards: Card[];
  votedIds: number[];
  count: number;
}) {
  const voted = new Set(votedIds);
  const mutation = useToggleVote(
    roundId,
    viewKey,
    cards.map((card) => card.id),
  );
  const pending = mutation.isPending || !ready;
  // Mobile always renders the whole page (20/50/100) as one scrolling list, no swipe chunks.
  // Desktop keeps the one-screen 4×5 board at 20 and scrolls for bigger pages.
  const fitsOneScreen = size <= DESKTOP_FIT_MAX;
  const error = mutation.error?.message ?? "";
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
        className={`grid min-h-0 flex-1 gap-2 p-1 ${
          fitsOneScreen
            ? "auto-rows-[5.75rem] grid-cols-2 content-start overflow-y-auto overscroll-contain sm:auto-rows-auto sm:grid-cols-4 sm:grid-rows-5 sm:content-stretch sm:overflow-visible"
            : "auto-rows-[5.75rem] grid-cols-2 content-start overflow-y-auto overscroll-contain sm:auto-rows-[6.5rem] sm:grid-cols-4 lg:grid-cols-5"
        }`}
      >
        {cards.map((card, index) => {
          const selected = voted.has(card.id);
          const domain = splitDomain(card.name);
          const price = tilePrice(card.price, card.currency);
          return (
            <li
              key={card.id}
              className="vote-enter min-h-0"
              style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
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
    </div>
  );
}
