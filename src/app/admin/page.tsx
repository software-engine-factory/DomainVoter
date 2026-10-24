import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ProgressBar, buttonClass } from "@/components/ui";
import { formatPercent, formatWhen } from "@/lib/format";
import { listRounds } from "@/lib/rounds";

export const metadata: Metadata = { title: "دورها" };

export default function AdminHomePage() {
  const rounds = listRounds();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">دورهای رأی‌گیری</h1>
          <p className="mt-3 text-muted">پوشش، سهم دامنه‌هایی است که دست‌کم یک رأی‌دهنده آن‌ها را باز کرده است.</p>
        </div>
        <Link href="/admin/rounds/new" className={buttonClass()}>
          ساخت دور
        </Link>
      </div>

      {rounds.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <h2 className="font-display text-3xl">هنوز دوری نیست</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">برای باز کردن اولین دور، یک فایل CSV بارگذاری کنید.</p>
          <Link href="/admin/rounds/new" className={`${buttonClass()} mt-6`}>
            ساخت دور
          </Link>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {rounds.map((round) => {
            const percent = formatPercent(round.viewedCount, round.domainCount);
            return (
              <li key={round.id}>
                <Link
                  href={`/admin/rounds/${round.id}`}
                  className="grid gap-4 px-5 py-5 transition hover:bg-paper sm:grid-cols-[1fr_16rem]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-3xl">{round.title}</h2>
                      <Badge tone={round.status === "open" ? "accent" : "muted"}>{round.status === "open" ? "باز" : "بسته"}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {round.domainCount} دامنه · {formatWhen(round.createdAt)}
                    </p>
                    {round.parentTitle ? <p className="mt-1 text-sm text-muted">از {round.parentTitle}</p> : null}
                  </div>
                  <div className="flex flex-col justify-center">
                    <ProgressBar value={percent} label="دامنه‌های دیده‌شده" />
                    <p className="mt-2 text-xs text-muted">
                      {round.viewedCount} از {round.domainCount} را یک رأی‌دهنده باز کرده است
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
