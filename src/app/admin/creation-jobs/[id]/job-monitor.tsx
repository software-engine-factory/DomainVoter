"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { buttonClass } from "@/components/ui";

type Snapshot = { id: string; title: string; state: string; phase: string; processed: number; total: number; resultUrl: string | null; error: string | null; cancelRequested: boolean; updatedAt: number };
const phases: Record<string, string> = { selecting: "انتخاب و مرتب‌سازی نام‌ها", staging: "ثبت فهرست انتخاب‌شده", materializing: "ساخت دورها", cleanup: "پاک‌سازی عملیات لغوشده", done: "ساخت کامل شد" };
const errors: Record<string, string> = { no_matches: "نامی با این فیلترها پیدا نشد.", too_many_rounds: "تعداد دورها از سقف ۲۰۰۰ بیشتر است. اندازهٔ هر دور را افزایش دهید.", source_changed: "دادهٔ انتخاب‌شده تغییر کرده است. عملیات متوقف شد.", manifest_changed: "فهرست ذخیره‌شده قابل تأیید نیست.", worker_unavailable: "پردازشگر ساخت در دسترس نیست." };

export function JobMonitor({ initial }: { initial: Snapshot }) {
  const [job, setJob] = useState(initial), [warning, setWarning] = useState("");
  const [acting, setActing] = useState(false);
  const queryClient = useQueryClient();
  const terminal = ["completed", "cancelled", "failed"].includes(job.state);
  useEffect(() => {
    if (terminal) {
      if (job.state === "completed") void queryClient.invalidateQueries();
      return;
    }
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    let delay = 750, last = 0;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/creation-jobs/${job.id}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("status");
        const next: Snapshot = await response.json();
        if (stopped) return;
        setJob(current => next.updatedAt >= current.updatedAt ? next : current); setWarning("");
        delay = next.updatedAt === last ? Math.min(delay * 1.5, 5000) : 750;
        last = next.updatedAt;
      } catch {
        if (stopped) return;
        setWarning("دریافت وضعیت قطع شده است. تلاش مجدد به‌صورت خودکار انجام می‌شود.");
        delay = Math.min(delay * 2, 15_000);
      }
      if (!stopped) timer = setTimeout(poll, document.hidden ? Math.max(5000, delay) : delay);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [job.id, job.state, terminal, queryClient]);
  async function act(action: "cancel" | "retry") {
    setActing(true);
    try {
      const response = await fetch(`/api/creation-jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error("action");
      const next = await fetch(`/api/creation-jobs/${job.id}`, { cache: "no-store" });
      if (!next.ok) throw new Error("status");
      setJob(await next.json()); setWarning("");
    } catch { setWarning("درخواست انجام نشد. دوباره تلاش کنید."); }
    finally { setActing(false); }
  }
  return <section className="space-y-5" data-testid="creation-monitor">
    <p className="text-sm text-muted">عملیات ساخت</p>
    <h1 className="font-display text-3xl">{job.title}</h1>
    <div className="rounded-2xl border border-line bg-card p-5">
      <p role="status" aria-live="polite" className="font-semibold">{job.state === "cancelled" ? "عملیات لغو و داده‌های ناتمام پاک شد." : job.state === "failed" ? "ساخت متوقف شد." : phases[job.phase] ?? "در انتظار پردازش"}</p>
      {job.state === "completed" ? <p className="mt-3 text-sm tabular-nums">{job.processed.toLocaleString("fa-IR")} نام آماده شد.</p> : null}
      {!terminal && job.total > 0 ? <><progress aria-label="پیشرفت مرحلهٔ فعلی" value={job.processed} max={job.total} className="my-4 h-3 w-full accent-accent" /><p className="text-sm tabular-nums">{job.processed.toLocaleString("fa-IR")} از {job.total.toLocaleString("fa-IR")}</p></> : !terminal ? <progress aria-label="در حال انتخاب نام‌ها" className="my-4 w-full" /> : null}
      {!terminal ? <p className="mt-3 text-sm text-muted">ساخت در پس‌زمینه ادامه دارد. می‌توانید این صفحه را ببندید و با همین نشانی برگردید. دورهای ناتمام برای رأی‌دهندگان نمایش داده نمی‌شوند.</p> : null}
      {job.cancelRequested && !terminal ? <p className="mt-3 text-sm">درخواست لغو ثبت شد. منتظر توقف و پاک‌سازی باشید.</p> : null}
      {job.error ? <p role="alert" className="mt-3 text-sm text-danger">{errors[job.error] ?? "خطایی هنگام ساخت رخ داد. می‌توانید همین عملیات را دوباره ادامه دهید."}</p> : null}
      {warning ? <p role="alert" className="mt-3 text-sm text-danger">{warning}</p> : null}
    </div>
    <div className="flex flex-wrap gap-3">
      {job.state === "completed" && job.resultUrl ? <Link href={job.resultUrl} className={buttonClass("primary")}>مشاهدهٔ نتیجه</Link> : null}
      {!terminal ? <button type="button" disabled={acting || job.cancelRequested} onClick={() => act("cancel")} className={buttonClass("ghost")}>لغو ساخت</button> : null}
      {job.state === "failed" ? <><button type="button" disabled={acting} onClick={() => act("retry")} className={buttonClass("primary")}>ادامهٔ همین عملیات</button><button type="button" disabled={acting} onClick={() => act("cancel")} className={buttonClass("ghost")}>پاک‌سازی و لغو</button></> : null}
      <Link href="/admin/creation-jobs" className={buttonClass("ghost")}>همهٔ عملیات</Link>
      <Link href="/admin" className={buttonClass("ghost")}>مدیریت دورها</Link>
    </div>
    <p dir="ltr" className="break-all text-xs text-muted">{job.id}</p>
  </section>;
}
