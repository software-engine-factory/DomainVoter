"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toggleVote } from "@/lib/actions/votes";
import { qk } from "@/lib/query/keys";
import { formatWhen } from "@/lib/format";
import type { MyBookmark } from "@/lib/my-bookmarks";
import { t } from "@/lib/copy/fa";

type Scope = "all" | "open";

function splitDomain(name: string) {
  const dot = name.indexOf(".");
  if (dot <= 0) return { label: name, suffix: "" };
  return { label: name.slice(0, dot), suffix: name.slice(dot) };
}

export function MyBookmarks({ initial }: { initial: MyBookmark[] }) {
  const c = t.myBookmarks;
  const client = useQueryClient();
  const [items, setItems] = useState(initial);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [undo, setUndo] = useState<MyBookmark | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (scope === "all" || item.roundOpen) &&
        (!q || item.name.toLowerCase().includes(q) || item.roundTitle.toLowerCase().includes(q)),
    );
  }, [items, query, scope]);

  function remove(item: MyBookmark) {
    setError("");
    setLeaving((s) => new Set(s).add(item.domainId));
    startTransition(async () => {
      const result = await toggleVote(item.domainId);
      if ("error" in result) {
        setLeaving((s) => { const n = new Set(s); n.delete(item.domainId); return n; });
        setError(result.error);
        return;
      }
      client.invalidateQueries({ queryKey: qk.myVotesAll(item.roundId) });
      setTimeout(() => {
        setItems((list) => list.filter((x) => x.domainId !== item.domainId));
        setLeaving((s) => { const n = new Set(s); n.delete(item.domainId); return n; });
      }, 220);
      setUndo(item);
    });
  }

  function restore() {
    const item = undo;
    if (!item) return;
    setUndo(null);
    startTransition(async () => {
      const result = await toggleVote(item.domainId);
      if ("error" in result) return setError(result.error);
      client.invalidateQueries({ queryKey: qk.myVotesAll(item.roundId) });
      setItems((list) => [{ ...item, votedAt: Date.now() }, ...list]);
    });
  }

  if (items.length === 0 && !undo) {
    return (
      <div className="page-enter mt-8 rounded-2xl border border-dashed border-line bg-card px-6 py-14 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M6 3.5h12v17l-6-4.2-6 4.2z" />
          </svg>
        </div>
        <h2 className="mt-4 font-display text-3xl">{c.emptyTitle}</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">{c.emptyBody}</p>
        <Link href="/vote" className="press mt-6 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold text-paper">
          {c.emptyCta}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-2 py-1 sm:top-16 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">{c.search}</span>
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3 3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={c.search}
            className="h-11 w-full rounded-full border border-line bg-card ps-9 pe-4 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </label>
        <div role="radiogroup" aria-label={c.scope} className="flex shrink-0 rounded-full border border-line bg-card p-1 text-sm">
          {(["all", "open"] as Scope[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              onClick={() => setScope(value)}
              className={`press flex-1 whitespace-nowrap rounded-full px-4 py-1.5 ${scope === value ? "bg-accent font-semibold text-paper" : "text-muted hover:text-ink"}`}
            >
              {value === "all" ? c.scopeAll : c.scopeOpen}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-muted" aria-live="polite">
        {c.count(visible.length, items.length)}
      </p>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}

      {visible.length === 0 ? (
        <p className="page-enter mt-6 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{c.noMatch}</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {visible.map((item, index) => {
            const d = splitDomain(item.name);
            const out = leaving.has(item.domainId);
            return (
              <li
                key={item.domainId}
                className={`vote-enter grid transition-all duration-200 ease-out ${out ? "grid-rows-[0fr] scale-95 opacity-0" : "grid-rows-[1fr]"}`}
                style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p dir="ltr" className="truncate text-left font-mono text-xl font-semibold tracking-tight text-ink">
                        {d.label}
                        <span className="text-sm font-medium text-muted">{d.suffix}</span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                        <Link href={`/vote/${item.roundId}`} className="truncate underline-offset-2 hover:text-ink hover:underline">
                          {item.roundTitle}
                        </Link>
                        <span aria-hidden>·</span>
                        <span>{formatWhen(item.votedAt)}</span>
                        {!item.roundOpen ? (
                          <span className="rounded-full border border-line px-1.5 leading-5">{c.closed}</span>
                        ) : null}
                      </p>
                    </div>
                    {item.roundOpen ? (
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        disabled={out}
                        aria-label={c.removeLabel(item.name)}
                        className="press grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent hover:bg-accent hover:text-paper active:scale-90"
                      >
                        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
                          <path d="M6 3.5h12v17l-6-4.2-6 4.2z" />
                        </svg>
                      </button>
                    ) : (
                      <span title={c.lockedHint} className="grid size-10 shrink-0 place-items-center rounded-full text-muted" aria-label={c.lockedHint}>
                        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
                        </svg>
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {undo && mounted ? createPortal(
        <div role="status" className="page-enter fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-full bg-ink px-5 py-3 text-sm text-paper shadow-lg">
          <span dir="auto" className="truncate">{c.removed(undo.name)}</span>
          <button type="button" onClick={restore} className="press shrink-0 font-semibold text-accent-soft underline-offset-2 hover:underline">
            {c.undo}
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
