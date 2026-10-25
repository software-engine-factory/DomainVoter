"use client";

import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

/**
 * GET form whose fields live in the URL. Selects and checkboxes apply on change,
 * text fields on Enter or the button, so filters are shareable links.
 */
export function AutoSubmitForm({ action, children, className }: { action: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const go = () => {
    const form = ref.current;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      const text = String(value).trim();
      if (text !== "" && key !== "page") params.append(key, text);
    }
    const qs = params.toString();
    router.push(qs ? `${action}?${qs}` : action);
  };
  return (
    <form
      ref={ref}
      action={action}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        go();
      }}
      onChange={(event) => {
        const target = event.target as unknown as HTMLInputElement;
        if (target.tagName === "SELECT" || target.type === "checkbox" || target.type === "radio" || target.type === "date") go();
      }}
    >
      {children}
    </form>
  );
}
