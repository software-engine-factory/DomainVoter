"use client";

import { useRef, useState, type ReactNode, type RefObject, type FormEventHandler, type KeyboardEventHandler } from "react";
import { useRouter } from "next/navigation";

/** Capture the clicked creation mode before React disables either submit button. */
export function CreationForm({ kind, children, className, formRef, onChange, ...props }: {
  kind: "pool" | "batch" | "explore"; children: ReactNode; className?: string;
  formRef?: RefObject<HTMLFormElement | null>; onChange?: FormEventHandler<HTMLFormElement>;
  onKeyDown?: KeyboardEventHandler<HTMLFormElement>;
  "data-testid"?: string;
}) {
  const router = useRouter();
  const busy = useRef(false), key = useRef<string | null>(null), previous = useRef<string>("");
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  return <form {...props} ref={formRef} className={className} onChange={onChange} aria-busy={pending} onSubmit={async event => {
    event.preventDefault();
    if (busy.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, submitter);
    form.set("kind", kind);
    const fingerprint = JSON.stringify([...form.entries()]);
    if (fingerprint !== previous.current) { key.current = crypto.randomUUID(); previous.current = fingerprint; }
    key.current ??= crypto.randomUUID();
    busy.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch("/api/creation-jobs", { method: "POST", body: form, headers: { "Idempotency-Key": key.current } });
      const result = await response.json();
      if (!response.ok) {
        setMessage(response.status === 429 ? "یک عملیات ساخت در حال اجراست. از صفحهٔ عملیات وضعیت آن را ببینید و کمی بعد دوباره تلاش کنید." : "درخواست پذیرفته نشد. عنوان و تنظیمات را بررسی کنید.");
        busy.current = false; setPending(false); return;
      }
      router.push(result.statusUrl);
    } catch {
      setMessage("پاسخ سرور دریافت نشد. با همان تنظیمات دوباره تلاش کنید؛ شناسهٔ درخواست حفظ می‌شود.");
      busy.current = false; setPending(false);
    }
  }}>
    <fieldset disabled={pending} className="contents">{children}</fieldset>
    {pending ? <p role="status" aria-live="polite" className="col-span-full rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm">در حال ثبت درخواست… پس از پذیرش می‌توانید پیشرفت ساخت را ببینید.</p> : null}
    {message ? <p role="alert" className="col-span-full rounded-xl border border-danger/30 p-3 text-sm text-danger">{message}</p> : null}
  </form>;
}
