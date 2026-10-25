import type { Metadata } from "next";
import Link from "next/link";
import { rate } from "@/components/admin/stat-card";
import { formatWhen } from "@/lib/format";
import { listUserStats } from "@/lib/insights";

export const metadata: Metadata = { title: "کاربران" };

export default function UsersPage() {
  const users = listUserStats();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">کاربران</h1>
      <p className="mt-1 text-sm text-muted">
        مرتب بر اساس شمار انتخاب‌هایی که مدیر نشان کرده؛ برای دیدن جزئیات و دادن پاداش روی نام کاربر بزنید.
      </p>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {users.map((u) => (
          <li key={u.id}>
            <Link href={`/admin/users/${u.id}`} className="block rounded-xl border border-line bg-card p-3 hover:border-ink">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{u.username}</span>
                <span className="text-xs text-muted">{u.lastSeen ? `آخرین: ${formatWhen(u.lastSeen)}` : "هنوز ندیده"}</span>
              </div>
              <dl className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                <div><dt className="text-muted">دیده</dt><dd className="text-base font-semibold tabular-nums">{u.views}</dd></div>
                <div><dt className="text-muted">انتخاب</dt><dd className="text-base font-semibold tabular-nums">{u.votes}</dd></div>
                <div><dt className="text-muted">نرخ</dt><dd className="text-base font-semibold tabular-nums">{rate(u.votes, u.views)}</dd></div>
                <div><dt className="text-muted">نشان‌شده</dt><dd className="text-base font-semibold tabular-nums">{u.bookmarkedHits}</dd></div>
              </dl>
              <div className="mt-1 text-xs text-muted">{u.rounds} دور · {u.activeDays} روز فعال</div>
            </Link>
          </li>
        ))}
        {users.length === 0 ? <li className="text-muted">هنوز کاربری نیست.</li> : null}
      </ul>
    </main>
  );
}
