import type { Metadata } from "next";
import Link from "next/link";
import { AutoSubmitForm } from "@/components/admin/auto-submit-form";
import { BookmarkButton } from "@/components/admin/bookmark-button";
import { Badge, buttonClass, fieldClass } from "@/components/ui";
import { updateBookmarkAction } from "@/lib/actions/bookmarks";
import { PICK_STATUSES, PICK_STATUS_LABELS, listBookmarks } from "@/lib/bookmarks";
import { formatMoney, formatWhen, one, withParams } from "@/lib/format";
import { nameProvenance, voterOptions } from "@/lib/insights";

export const metadata: Metadata = { title: "نشان‌شده‌ها" };

export default async function BookmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const status = one(params.status) ?? "";
  const userId = Number(one(params.user)) || null;
  const q = (one(params.q) ?? "").trim();
  const rows = listBookmarks({ status, userId, q });
  const provenance = nameProvenance(rows.map((r) => r.name));
  const users = voterOptions();
  const back = withParams("/admin/bookmarks", { status, user: userId ?? undefined, q });
  const field = `${fieldClass} h-9`;

  // Bonus ledger: for each voter, how many bookmarked names they chose first / at all.
  const ledger = new Map<string, { first: number; any: number; bonus: number }>();
  for (const row of rows) {
    const list = provenance.get(row.name) ?? [];
    list.forEach((entry, i) => {
      const item = ledger.get(entry.username) ?? { first: 0, any: 0, bonus: 0 };
      item.any++;
      if (i === 0) item.first++;
      ledger.set(entry.username, item);
    });
    if (row.bonusUsername) {
      const item = ledger.get(row.bonusUsername) ?? { first: 0, any: 0, bonus: 0 };
      item.bonus++;
      ledger.set(row.bonusUsername, item);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">نشان‌شده‌های مدیر</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        خصوصی: کاربران این فهرست را نمی‌بینند و خبردار نمی‌شوند. برای هر نام، چه کسانی و کِی انتخابش کرده‌اند ثبت می‌شود تا پاداش به نفر درست برسد.
        همین فهرست در <Link className="underline" href="/admin/picks">منتخب‌ها</Link> هم هست.
      </p>

      <AutoSubmitForm action="/admin/bookmarks" className="mt-4 flex flex-wrap gap-2 text-sm">
        <input name="q" defaultValue={q} placeholder="بخشی از نام" dir="ltr" className={`${field} w-40`} />
        <select name="status" defaultValue={status} className={`${field} w-36`} aria-label="وضعیت">
          <option value="">همهٔ وضعیت‌ها</option>
          {PICK_STATUSES.map((s) => <option key={s} value={s}>{PICK_STATUS_LABELS[s]}</option>)}
        </select>
        <select name="user" defaultValue={userId ?? ""} className={`${field} w-36`} aria-label="انتخاب‌کننده">
          <option value="">همهٔ کاربران</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        {status || userId || q ? <Link href="/admin/bookmarks" className={buttonClass("ghost", "sm")}>پاک کردن</Link> : null}
      </AutoSubmitForm>

      {ledger.size ? (
        <section className="mt-4 rounded-xl border border-line bg-card p-3 text-sm">
          <h2 className="font-semibold">حساب پاداش (در همین فهرست)</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...ledger.entries()].sort((a, b) => b[1].first - a[1].first || b[1].any - a[1].any).map(([name, item]) => (
              <li key={name} className="rounded-lg border border-line bg-paper px-2 py-1">
                <span className="font-semibold">{name}</span>{" "}
                <span className="text-xs text-muted">اول {item.first} · کل {item.any} · پاداش {item.bonus}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const who = provenance.get(row.name) ?? [];
          return (
            <li key={row.name} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <a href={row.url ?? `https://${row.name}`} target="_blank" rel="noreferrer noopener" dir="ltr" className="break-all font-mono font-semibold">{row.name} ↗</a>
                    <span dir="ltr" className="text-xs">{formatMoney(row.price, row.currency, true)}</span>
                    <Badge tone={row.status === "bought" || row.status === "bonus_paid" ? "gold" : "muted"}>{PICK_STATUS_LABELS[row.status] ?? row.status}</Badge>
                  </div>
                  <div className="text-xs text-muted">
                    نشان شد {formatWhen(row.createdAt)}
                    {row.sourceUsername ? <> از انتخاب‌های <b>{row.sourceUsername}</b></> : null}
                    {row.marketplace ? <> · {row.marketplace}</> : null}
                  </div>
                </div>
                <BookmarkButton name={row.name} on back={back} />
              </div>
              <div className="mt-2 text-xs">
                <span className="text-muted">انتخاب‌کنندگان: </span>
                {who.length === 0 ? <span className="text-muted">هیچ کاربری انتخابش نکرده</span> : null}
                {who.map((entry, i) => (
                  <span key={`${entry.userId}-${entry.roundId}`} className="me-2 inline-block">
                    <Link className="underline" href={`/admin/users/${entry.userId}`}>{entry.username}</Link>
                    {i === 0 ? " (اول)" : ""} <span className="text-muted">{formatWhen(entry.votedAt)} · دور #{entry.roundId}{entry.live ? "" : " · رأی پس‌گرفته"}</span>
                  </span>
                ))}
              </div>
              <form action={updateBookmarkAction} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="name" value={row.name} />
                <input type="hidden" name="back" value={back} />
                <select name="status" defaultValue={row.status} className={`${field} w-32`} aria-label="وضعیت">
                  {PICK_STATUSES.map((s) => <option key={s} value={s}>{PICK_STATUS_LABELS[s]}</option>)}
                </select>
                <select name="bonusUserId" defaultValue={row.bonusUserId ?? (who[0]?.userId ?? "")} className={`${field} w-32`} aria-label="پاداش به">
                  <option value="">پاداش به —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
                <input name="note" defaultValue={row.note ?? ""} placeholder="یادداشت" className={`${field} min-w-0 flex-1`} />
                <button className={buttonClass("secondary", "sm")}>ذخیره</button>
              </form>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="py-8 text-center text-muted">نشان‌شده‌ای با این فیلترها نیست. از صفحهٔ کاربر یا جست‌وجوی فعالیت روی ☆ بزنید.</li> : null}
      </ul>
    </main>
  );
}
