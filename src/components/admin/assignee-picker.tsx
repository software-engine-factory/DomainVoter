"use client";

import { useState } from "react";
import { t } from "@/lib/copy/fa";

export type PickerUser = { id: number; username: string; role: "voter" | "admin" };

/**
 * Optional multi-select of users who may see a round. Nothing checked = everyone sees it.
 * Submits as repeated `assignees` fields, so it works inside any server-action form.
 */
export function AssigneePicker({ users, initial = [], compact = false }: { users: PickerUser[]; initial?: number[]; compact?: boolean }) {
  const c = t.assignees;
  const [picked, setPicked] = useState<Set<number>>(() => new Set(initial));
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? users.filter((u) => u.username.toLowerCase().includes(needle)) : users;

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <fieldset data-testid="assignee-picker" className={`rounded-xl border border-line ${compact ? "p-3" : "p-3 sm:p-4"}`}>
      <legend className="px-1 text-sm font-semibold">{c.label}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted" aria-live="polite">
          {picked.size === 0 ? c.everyone : c.only(picked.size)}
        </p>
        {picked.size > 0 ? (
          <button type="button" onClick={() => setPicked(new Set())} className="press text-xs font-semibold text-accent underline-offset-4 hover:underline">
            {c.clear}
          </button>
        ) : null}
      </div>
      {users.length > 8 ? (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // keep the parent form's onChange (live counters) out of this
          onInput={(e) => e.stopPropagation()}
          placeholder={c.search}
          aria-label={c.search}
          className="mt-2 h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
      ) : null}
      <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto p-0.5">
        {shown.map((u) => {
          const on = picked.has(u.id);
          return (
            <label
              key={u.id}
              className={`press inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 ${
                on ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line bg-card text-muted hover:text-ink"
              }`}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(u.id)} className="sr-only" />
              <span aria-hidden className={`grid size-4 place-items-center rounded-full border ${on ? "border-accent bg-accent text-paper" : "border-line"}`}>
                {on ? (
                  <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="m2.5 6.5 2.2 2 4.8-5" /></svg>
                ) : null}
              </span>
              <span dir="ltr">{u.username}</span>
              {u.role === "admin" ? <span className="text-[10px] text-muted">{c.adminTag}</span> : null}
            </label>
          );
        })}
        {shown.length === 0 ? <p className="text-xs text-muted">{c.noUsers}</p> : null}
      </div>
      {[...picked].map((id) => (
        <input key={id} type="hidden" name="assignees" value={id} />
      ))}
      <p className="mt-2 text-xs text-muted">{c.hint}</p>
    </fieldset>
  );
}

/** Read-only chips for lists. */
export function AssigneeChips({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-xs text-muted">{t.assignees.everyoneShort}</span>;
  return (
    <span className="inline-flex flex-wrap gap-1" title={t.assignees.label}>
      {names.map((n) => (
        <span key={n} dir="ltr" className="rounded-full border border-line bg-paper px-2 text-xs leading-5 text-ink">
          {n}
        </span>
      ))}
    </span>
  );
}
