import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { AutoSubmitForm } from "@/components/admin/auto-submit-form";
import { BookmarkButton } from "@/components/admin/bookmark-button";
import { Badge, buttonClass, fieldBase } from "@/components/ui";
import { updateBookmarkAction } from "@/lib/actions/bookmarks";
import { PICK_STATUSES, PICK_STATUS_LABELS, listBookmarks } from "@/lib/bookmarks";
import { formatMoney, formatWhen, one, withParams } from "@/lib/format";
import { nameProvenance, voterOptions } from "@/lib/insights";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.bookmarks.title };

export default async function BookmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // the layout checks too, but pages render in parallel with it
  const params = await searchParams;
  const status = one(params.status) ?? "";
  const userId = Number(one(params.user)) || null;
  const q = (one(params.q) ?? "").trim();
  const rows = listBookmarks({ status, userId, q });
  const provenance = nameProvenance(rows.map((r) => r.name));
  const users = voterOptions();
  const back = withParams("/admin/bookmarks", { status, user: userId ?? undefined, q });
  const field = `${fieldBase} h-9 text-sm`;

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
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{t.bookmarks.heading}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {t.bookmarks.leadPrivate}
        {t.bookmarks.leadSame} <Link className="underline" href="/admin/picks">{t.bookmarks.leadSameLink}</Link> {t.bookmarks.leadSameTail}
      </p>

      <AutoSubmitForm action="/admin/bookmarks" className="mt-4 grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap sm:items-center">
        <input name="q" defaultValue={q} placeholder={t.bookmarks.namePart} dir="ltr" className={`${field} col-span-2 w-full sm:w-56`} />
        <select name="status" defaultValue={status} className={`${field} w-full sm:w-44`} aria-label={t.bookmarks.status}>
          <option value="">{t.bookmarks.allStatuses}</option>
          {PICK_STATUSES.map((s) => <option key={s} value={s}>{PICK_STATUS_LABELS[s]}</option>)}
        </select>
        <select name="user" defaultValue={userId ?? ""} className={`${field} w-full sm:w-44`} aria-label={t.bookmarks.voter}>
          <option value="">{t.bookmarks.allUsers}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        {status || userId || q ? <Link href="/admin/bookmarks" className={buttonClass("ghost", "sm")}>{t.bookmarks.clear}</Link> : null}
      </AutoSubmitForm>

      {ledger.size ? (
        <section className="mt-4 rounded-xl border border-line bg-card p-3 text-sm">
          <h2 className="font-semibold">{t.bookmarks.tallyTitle}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...ledger.entries()].sort((a, b) => b[1].first - a[1].first || b[1].any - a[1].any).map(([name, item]) => (
              <li key={name} className="rounded-lg border border-line bg-paper px-2 py-1">
                <span className="font-semibold">{name}</span>{" "}
                <span className="text-xs text-muted">{t.bookmarks.tally(item.first, item.any, item.bonus)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const who = provenance.get(row.name) ?? [];
          return (
            <li key={row.name} className="grid gap-3 rounded-xl border border-line bg-card p-3 text-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex min-w-0 items-start gap-2">
                <BookmarkButton name={row.name} on back={back} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <a href={row.url ?? `https://${row.name}`} target="_blank" rel="noreferrer noopener" dir="ltr" className="break-all font-mono font-semibold">{row.name} ↗</a>
                    <span dir="ltr" className="text-xs">{formatMoney(row.price, row.currency, true)}</span>
                    <Badge tone={row.status === "bought" || row.status === "bonus_paid" ? "gold" : "muted"}>{PICK_STATUS_LABELS[row.status] ?? row.status}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {t.bookmarks.bookmarkedAt} {formatWhen(row.createdAt)}
                    {row.sourceUsername ? <> {t.bookmarks.fromVotesOf} <b>{row.sourceUsername}</b></> : null}
                    {row.marketplace ? <> · {row.marketplace}</> : null}
                  </div>
                  <div className="mt-0.5 text-xs">
                    <span className="text-muted">{t.bookmarks.votersLabel}</span>
                    {who.length === 0 ? <span className="text-muted">{t.bookmarks.noVoters}</span> : null}
                    {who.map((entry, i) => (
                      <span key={`${entry.userId}-${entry.roundId}`} className="me-2 inline-block">
                        <Link className="underline" href={`/admin/users/${entry.userId}`}>{entry.username}</Link>
                        {i === 0 ? t.bookmarks.firstMark : ""} <span className="text-muted">{formatWhen(entry.votedAt)} · {t.bookmarks.roundRef(entry.roundId)}{entry.live ? "" : t.bookmarks.retracted}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <form action={updateBookmarkAction} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:flex-nowrap">
                <input type="hidden" name="name" value={row.name} />
                <input type="hidden" name="back" value={back} />
                <select name="status" defaultValue={row.status} className={`${field} w-full sm:w-44`} aria-label={t.bookmarks.status}>
                  {PICK_STATUSES.map((s) => <option key={s} value={s}>{PICK_STATUS_LABELS[s]}</option>)}
                </select>
                <select name="bonusUserId" defaultValue={row.bonusUserId ?? (who[0]?.userId ?? "")} className={`${field} w-full sm:w-40`} aria-label={t.bookmarks.bonusTo}>
                  <option value="">{t.bookmarks.bonusToNone}</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
                <input name="note" defaultValue={row.note ?? ""} placeholder={t.bookmarks.note} className={`${field} w-full sm:w-48`} />
                <button className={buttonClass("secondary", "sm")}>{t.bookmarks.save}</button>
              </form>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="py-8 text-center text-muted">{t.bookmarks.empty}</li> : null}
      </ul>
    </main>
  );
}
