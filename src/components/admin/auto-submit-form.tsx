"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition, type ReactNode } from "react";
import { t } from "@/lib/copy/fa";

/**
 * GET form whose fields live in the URL. Selects and checkboxes apply on change,
 * text fields on Enter or the button, so filters are shareable links.
 * While the filtered page loads, the form shows a thin progress bar and is marked busy.
 */
export function AutoSubmitForm({ action, children, className }: { action: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const go = () => {
    const form = ref.current;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      const text = String(value).trim();
      if (text !== "" && key !== "page") params.append(key, text);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${action}?${qs}` : action));
  };
  return (
    <form
      ref={ref}
      action={action}
      aria-busy={pending || undefined}
      className={`relative ${className ?? ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        go();
      }}
      onChange={(event) => {
        const target = event.target as unknown as HTMLInputElement;
        if (target.dataset.nosubmit != null) return;
        if (target.tagName === "SELECT" || target.type === "checkbox" || target.type === "radio" || target.type === "date") go();
      }}
    >
      <span aria-hidden className={`busy-bar busy-form ${pending ? "is-busy" : ""}`} />
      <span role="status" className="sr-only">{pending ? t.pending.updating : ""}</span>
      {children}
    </form>
  );
}
