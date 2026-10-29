import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSqlite } from "@/db";
import { buttonClass } from "@/components/ui";

export default async function CreationJobsPage() {
  const session = await requireAdmin();
  const jobs = getSqlite().prepare("SELECT id,input_json,state,created_at FROM creation_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 50").all(session.userId) as Array<{ id: string; input_json: string; state: string; created_at: number }>;
  const states: Record<string, string> = { queued: "در صف", running: "در حال ساخت", completed: "آماده", cancelling: "در حال لغو", cancelled: "لغوشده", failed: "متوقف‌شده" };
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6"><h1 className="font-display text-3xl">عملیات ساخت</h1><p className="my-3 text-sm text-muted">برای دیدن پیشرفت، ادامه یا نتیجه، عملیات را باز کنید.</p>
    <Link href="/admin/rounds/batch" className={buttonClass("primary")}>ساخت دستهٔ جدید</Link>
    <ul className="mt-5 divide-y divide-line rounded-xl border border-line">{jobs.map(job => <li key={job.id}><Link className="flex justify-between gap-4 p-4 text-sm" href={`/admin/creation-jobs/${job.id}`}><span>{JSON.parse(job.input_json).title}</span><span className="text-muted">{states[job.state]}</span></Link></li>)}</ul>
    {!jobs.length ? <p className="mt-4 text-sm text-muted">هنوز عملیاتی ثبت نشده است.</p> : null}
  </main>;
}
