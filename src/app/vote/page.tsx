import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatWhen } from "@/lib/format";
import { listOpenRounds } from "@/lib/rounds";

export const metadata: Metadata = { title: "دورهای باز" };

export default function VoteHomePage() {
  const rounds = listOpenRounds();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-5xl">دورهای باز</h1>
      <p className="mt-3 max-w-xl text-muted">یک دور را انتخاب کنید، بازه‌ای از فهرست را مشخص کنید و به دامنه‌هایی که می‌خواهید رأی بدهید.</p>
      {rounds.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <h2 className="font-display text-3xl">هیچ دوری باز نیست</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">وقتی مدیر یک دور رأی‌گیری باز کند، اینجا دیده می‌شود.</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {rounds.map((round) => (
            <li key={round.id}>
              <Link href={`/vote/${round.id}`} className="flex items-start justify-between gap-4 px-5 py-5 transition hover:bg-paper">
                <div>
                  <h2 className="font-display text-3xl">{round.title}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {round.domainCount} دامنه · باز شده {formatWhen(round.createdAt)}
                  </p>
                  {round.parentTitle ? <p className="mt-1 text-sm text-muted">از {round.parentTitle}</p> : null}
                </div>
                <Badge tone="accent">باز</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
