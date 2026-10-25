"use client";

import { useState, useTransition } from "react";
import { renameRoundAction } from "@/lib/actions/rounds";
import { t } from "@/lib/copy/fa";

/** Round title with an inline pencil: tap, edit, Enter saves, Esc cancels. */
export function RoundTitle({ id, title, className = "" }: { id: number; title: string; className?: string }) {
  const [value, setValue] = useState(title);
  const [shown, setShown] = useState(title);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save() {
    if (value.trim() === shown) return setEditing(false);
    start(async () => {
      const result = await renameRoundAction(id, value);
      if (result.ok) {
        setShown(result.title);
        setValue(result.title);
        setEditing(false);
        setError("");
      } else setError(result.error);
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className={`${className} min-w-0 break-words`} data-testid="round-title">{shown}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t.w4.rename}
          title={t.w4.rename}
          data-testid="rename-round"
          className="press grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <path d="M13.5 3.5l3 3L7 16H4v-3z" strokeLinejoin="round" />
          </svg>
        </button>
      </span>
    );
  }

  return (
    <span className="grid w-full max-w-md gap-1">
      <span className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          maxLength={80}
          disabled={pending}
          aria-label={t.w4.rename}
          data-testid="rename-input"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setValue(shown);
              setEditing(false);
              setError("");
            }
          }}
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 text-base font-semibold text-ink focus:border-accent focus:outline-none"
        />
        <button type="button" onClick={save} disabled={pending} className="press h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-50">
          {t.w4.save}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(shown);
            setEditing(false);
            setError("");
          }}
          className="press h-10 rounded-lg px-2 text-sm text-muted hover:text-ink"
        >
          {t.w4.cancel}
        </button>
      </span>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
