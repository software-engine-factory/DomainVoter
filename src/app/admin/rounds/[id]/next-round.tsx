"use client";

import { useEffect, useState } from "react";
import { countNextAction, nextRoundAction } from "@/lib/actions/rounds";
import { buttonClass } from "@/components/ui";
import { t } from "@/lib/copy/fa";

/** One-click "next round from votes": threshold (≥ N votes, or top N), optional carry-over of assignees. */
export function NextRound({ roundId, title, hasAssignees }: { roundId: number; title: string; hasAssignees: boolean }) {
  const c = t.w4.next;
  const [mode, setMode] = useState<"min" | "top">("min");
  const [n, setN] = useState("1");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void countNextAction(roundId, mode, n).then((r) => live && setCount(r.count));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [roundId, mode, n]);

  const seg = (id: "min" | "top", label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(id);
        setN(id === "top" ? "100" : "1");
      }}
      aria-pressed={mode === id}
      className={`press h-9 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold ${mode === id ? "bg-card text-ink shadow-sm" : "text-muted"}`}
    >
      {label}
    </button>
  );

  return (
    <form action={nextRoundAction} data-testid="next-round" className="grid gap-3 rounded-xl border border-line bg-card p-4">
      <input type="hidden" name="roundId" value={roundId} />
      <input type="hidden" name="mode" value={mode} />
      <h2 className="text-sm font-semibold">{c.title}</h2>
      <div className="grid gap-3 sm:grid-cols-[auto_6rem_1fr] sm:items-center">
        <div className="flex rounded-lg bg-paper p-1">
          {seg("min", c.atLeast)}
          {seg("top", c.top)}
        </div>
        <input
          name="n"
          value={n}
          onChange={(e) => setN(e.target.value.replace(/[^\d۰-۹]/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))))}
          inputMode="numeric"
          dir="ltr"
          aria-label={c.n}
          className="h-11 rounded-lg border border-line bg-paper px-3 text-center tabular-nums"
        />
        <input name="title" defaultValue={c.defaultTitle(title)} maxLength={80} required aria-label={t.newRound.roundTitle} className="h-11 rounded-lg border border-line bg-paper px-3" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasAssignees ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="carry" value="1" defaultChecked />
            {c.carry}
          </label>
        ) : (
          <span />
        )}
        <button className={buttonClass()} disabled={!count}>
          {count === 0 ? c.none : c.create(count ?? 0)}
        </button>
      </div>
    </form>
  );
}
