"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toggleVote } from "@/lib/actions/votes";
import { useMediaQuery } from "@/lib/theme/use-media";

// Mobile packs the server page into smaller one-screen chunks.
const MOBILE_CHUNK = 8;

type Card = {
  id: number;
  name: string;
};

function splitDomain(name: string) {
  const dot = name.indexOf(".");
  if (dot <= 0) return { label: name, suffix: "" };
  return { label: name.slice(0, dot), suffix: name.slice(dot) };
}

export function VoteGrid({
  cards,
  votedIds,
  initialCount,
  prevHref,
  nextHref,
}: {
  cards: Card[];
  votedIds: number[];
  initialCount: number;
  prevHref?: string;
  nextHref?: string;
}) {
  const router = useRouter();
  const [voted, setVoted] = useState(() => new Set(votedIds));
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const isMobile = useMediaQuery("(max-width: 639px)");
  const [chunk, setChunk] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const touchX = useRef<number | null>(null);
  const chunkCount = isMobile ? Math.max(1, Math.ceil(cards.length / MOBILE_CHUNK)) : 1;
  const activeChunk = Math.min(chunk, chunkCount - 1);
  const visible = isMobile ? cards.slice(activeChunk * MOBILE_CHUNK, (activeChunk + 1) * MOBILE_CHUNK) : cards;

  function goChunk(next: number) {
    // Past either end of this server page: move to the neighbouring page.
    if (next < 0) return void (prevHref && router.push(prevHref));
    if (next >= chunkCount) return void (nextHref && router.push(nextHref));
    if (next === activeChunk) return;
    setDirection(next > activeChunk ? "next" : "prev");
    setChunk(next);
  }

  function onToggle(id: number) {
    if (busy.current || pending) return;
    busy.current = true;
    const hadVote = voted.has(id);
    setError("");
    setVoted((current) => {
      const next = new Set(current);
      if (hadVote) next.delete(id);
      else next.add(id);
      return next;
    });
    setCount((current) => current + (hadVote ? -1 : 1));

    startTransition(async () => {
      try {
        const result = await toggleVote(id);
        if ("error" in result) {
          setVoted((current) => {
            const next = new Set(current);
            if (hadVote) next.add(id);
            else next.delete(id);
            return next;
          });
          setCount((current) => current + (hadVote ? 1 : -1));
          setError(result.error);
          return;
        }
        setVoted((current) => {
          const next = new Set(current);
          if (result.voted) next.add(id);
          else next.delete(id);
          return next;
        });
        setCount(result.count);
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-baseline justify-between gap-3 text-sm empty:hidden">
        <p className="hidden text-muted sm:block">
          به <span className="font-semibold tabular-nums text-ink">{count}</span> دامنه در این دور رأی داده‌اید.
        </p>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <ul
        key={isMobile ? `m${activeChunk}` : "d"}
        onTouchStart={(event) => (touchX.current = event.touches[0].clientX)}
        onTouchEnd={(event) => {
          if (touchX.current == null) return;
          const dx = event.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          // RTL: swiping right moves forward
          if (Math.abs(dx) > 50) goChunk(activeChunk + (dx > 0 ? 1 : -1));
        }}
        className={`grid min-h-0 flex-1 grid-cols-2 grid-rows-4 gap-2 p-1 sm:grid-cols-4 sm:grid-rows-5 ${
          isMobile ? (direction === "next" ? "slide-next" : "slide-prev") : ""
        }`}
      >
        {visible.map((card, index) => {
          const selected = voted.has(card.id);
          const domain = splitDomain(card.name);
          return (
            <li
              key={card.id}
              className="vote-enter min-h-0"
              style={{ animationDelay: `${index * (isMobile ? 28 : 16)}ms` }}
            >
              <button
                type="button"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => onToggle(card.id)}
                className={`vote-tile @container flex h-full w-full flex-col overflow-hidden rounded-xl border px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-100 ${
                  selected ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-accent/40"
                }`}
              >
                <span dir="ltr" className="flex min-h-0 w-full flex-1 items-center justify-start text-left">
                  <span className="flex min-w-0 items-baseline">
                    <span
                      className="truncate font-mono leading-none font-semibold tracking-tight text-ink"
                      style={{ fontSize: `clamp(1.15rem, ${Math.round(84 / Math.max(domain.label.length, 1))}cqw, 2.15rem)` }}
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
                <span className="mt-auto flex items-end justify-end gap-2 pt-2">
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${selected ? "text-accent" : "text-ink/70"}`}>
                    <svg viewBox="0 0 16 16" className="vote-mark size-3.5" aria-hidden>
                      <path
                        d="M3.5 8.2 6.4 11l6.1-6.2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {selected ? "رأی داده شد" : "رأی"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {isMobile && (chunkCount > 1 || prevHref || nextHref) ? (
        <div className="flex shrink-0 items-center justify-center gap-3 pt-2" dir="ltr">
          <button
            type="button"
            aria-label="‹"
            onClick={() => goChunk(activeChunk - 1)}
            disabled={activeChunk === 0 && !prevHref}
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
            aria-label="›"
            onClick={() => goChunk(activeChunk + 1)}
            disabled={activeChunk === chunkCount - 1 && !nextHref}
            className="press grid size-9 place-items-center rounded-full border border-line bg-card text-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
