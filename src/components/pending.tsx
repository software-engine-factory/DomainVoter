"use client";

import { useLinkStatus } from "next/link";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { t } from "@/lib/copy/fa";

/**
 * Thin bar along the bottom of a link while its navigation is pending. Must sit inside the <Link>.
 * Always rendered (no layout shift) and only fades in if the wait is noticeable (see .busy-bar).
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`busy-bar busy-link ${pending ? "is-busy" : ""}`} />;
}

/** Submit button for server-action forms: disabled with a "working" label until the action returns. */
export function SubmitButton({
  children,
  pendingLabel = t.pending.working,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button {...props} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? pendingLabel : children}
    </button>
  );
}
