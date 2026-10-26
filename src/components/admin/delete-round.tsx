"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteRoundAction, roundVoteSummaryAction } from "@/lib/actions/rounds";
import type { VoteSummary } from "@/lib/rounds";
import { t } from "@/lib/copy/fa";

/** Trash icon → confirmation sheet listing who voted on what (≤5 people × ≤3 names). */
export function DeleteRoundButton({ id, title }: { id: number; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<VoteSummary | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function show() {
    setError("");
    setSummary(null);
    setOpen(true);
    roundVoteSummaryAction(id).then(setSummary).catch(() => setSummary({ total: 0, users: [], moreUsers: 0 }));
  }
  function close() {
    if (pending) return;
    setOpen(false);
    triggerRef.current?.focus();
  }
  function confirm() {
    start(async () => {
      const result = await deleteRoundAction(id).catch(() => ({ ok: false as const, error: t.del.failed }));
      if (!result.ok) return setError(result.error);
      triggerRef.current?.closest("li")?.classList.add("row-out");
      setOpen(false);
      setTimeout(() => router.refresh(), 200);
    });
  }

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loading = summary === null;
  const hasVotes = !!summary && summary.total > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={show}
        aria-label={t.del.action}
        title={t.del.action}
        data-testid="delete-round"
        className="press grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <path d="M4 6h12M8 6V4.5h4V6m-6.5 0l.7 9.5h7.6L14.5 6M8.5 9v4m3-4v4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" dir="rtl">
              <div className="backdrop-in absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={close} aria-hidden />
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={`del-${id}`}
                data-testid="delete-modal"
                className="sheet-in relative w-full max-w-md rounded-t-2xl border border-line bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:rounded-2xl"
              >
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
                    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                      <path d="M4 6h12M8 6V4.5h4V6m-6.5 0l.7 9.5h7.6L14.5 6M8.5 9v4m3-4v4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 id={`del-${id}`} className="break-words font-display text-xl leading-snug">{t.del.title}{" «"}<bdi>{title}</bdi>{"»؟"}</h2>
                    <p className="mt-1 text-sm text-muted">{loading ? "\u00a0" : hasVotes ? t.del.withVotes(summary.total) : t.del.plain}</p>
                  </div>
                </div>

                {loading ? (
                  <div className="mt-4 h-24 animate-pulse rounded-xl bg-paper" />
                ) : hasVotes ? (
                  <ul className="pop-in mt-4 max-h-[50vh] overflow-y-auto rounded-xl border border-line bg-paper text-[13px]" data-testid="delete-votes">
                    {summary.users.flatMap((u) => [
                      ...u.names.map((name, i) => (
                        <li key={`${u.username}-${name}`} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
                          <span className={`w-24 shrink-0 truncate ${i === 0 ? "font-semibold text-ink" : "text-muted"}`}>{u.username}</span>
                          <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-ink">{name}</span>
                          {i === u.names.length - 1 && u.total > u.names.length ? (
                            <span className="shrink-0 rounded-full bg-chip px-2 py-0.5 text-xs text-muted">{t.del.moreNames(u.total - u.names.length)}</span>
                          ) : null}
                        </li>
                      )),
                    ])}
                    {summary.moreUsers > 0 ? <li className="px-3 py-2 text-muted">{t.del.moreUsers(summary.moreUsers)}</li> : null}
                  </ul>
                ) : null}

                {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    ref={cancelRef}
                    type="button"
                    onClick={close}
                    disabled={pending}
                    className="press h-11 rounded-xl border border-line bg-card text-sm font-semibold text-ink hover:bg-hover disabled:opacity-50"
                  >
                    {t.del.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={pending || loading}
                    data-testid="delete-confirm"
                    className="press h-11 rounded-xl bg-danger text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
                  >
                    {pending ? <span className="inline-block size-4 animate-spin rounded-full border-2 border-current/30 border-t-current align-middle" /> : t.del.confirm}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
