import type { Metadata } from "next";
import { buttonClass } from "@/components/ui";
import { togglePickAction, updatePickNoteAction } from "@/lib/actions/picks";
import { formatMoney } from "@/lib/format";
import { listPicks, topVotedNames } from "@/lib/rounds";

export const metadata: Metadata = { title: "منتخب‌ها" };

function NameLink({ name, url }: { name: string; url: string | null }) {
  const href = url ?? `https://${name}`;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" dir="ltr" className="break-all font-mono font-medium underline decoration-line underline-offset-4 hover:decoration-ink">
      {name} ↗
    </a>
  );
}

export default async function PicksPage() {
  const picks = listPicks();
  const top = topVotedNames(50);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl">فهرست منتخب</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        نام‌هایی که مدیر برگزیده، با لینک صفحهٔ فروش. چه کسی و کِی انتخابشان کرده در <a className="underline" href="/admin/bookmarks">نشان‌شده‌ها</a> است. شمار آرا روی همهٔ دورها و همهٔ رأی‌دهندگان جمع زده شده است.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="bg-card text-muted">
            <tr>
              <th className="px-3 py-3 text-start font-medium">دامنه</th>
              <th className="px-3 py-3 text-end font-medium">قیمت</th>
              <th className="px-3 py-3 text-start font-medium">بازار</th>
              <th className="px-3 py-3 text-start font-medium">پارکینگ / NS</th>
              <th className="px-3 py-3 text-end font-medium">آرا</th>
              <th className="px-3 py-3 text-end font-medium">رأی‌دهندگان</th>
              <th className="px-3 py-3 text-end font-medium">دورها</th>
              <th className="px-3 py-3 text-start font-medium">یادداشت</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {picks.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted">
                  هنوز منتخبی نیست. در نتایج هر دور روی ★ بزنید.
                </td>
              </tr>
            ) : null}
            {picks.map((pick) => (
              <tr key={pick.name} className="border-t border-line align-top">
                <td className="px-3 py-2.5"><NameLink name={pick.name} url={pick.url} /></td>
                <td dir="ltr" className="px-3 py-2.5 text-end tabular-nums">{formatMoney(pick.price, pick.currency, true)}</td>
                <td className="px-3 py-2.5">{pick.marketplace ?? pick.bestSource ?? "—"}</td>
                <td dir="ltr" className="px-3 py-2.5 text-start text-xs text-muted">
                  {pick.provider ?? "—"}{pick.nsClass ? ` · ${pick.nsClass}` : ""}
                </td>
                <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{pick.votes}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{pick.voters}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{pick.rounds}</td>
                <td className="px-3 py-2.5">
                  <form action={updatePickNoteAction} className="flex gap-2">
                    <input type="hidden" name="name" value={pick.name} />
                    <input name="note" defaultValue={pick.note ?? ""} className="h-8 w-40 rounded-md border border-line bg-paper px-2" />
                    <button className={buttonClass("ghost", "sm")}>ذخیره</button>
                  </form>
                </td>
                <td className="px-3 py-2.5">
                  <form action={togglePickAction}>
                    <input type="hidden" name="name" value={pick.name} />
                    <button className={buttonClass("ghost", "sm")}>حذف</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 font-display text-2xl">پررأی‌ترین‌ها در همهٔ دورها</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-card text-muted">
            <tr>
              <th className="px-3 py-3 text-start font-medium">دامنه</th>
              <th className="px-3 py-3 text-end font-medium">قیمت</th>
              <th className="px-3 py-3 text-start font-medium">پارکینگ</th>
              <th className="px-3 py-3 text-end font-medium">آرا</th>
              <th className="px-3 py-3 text-end font-medium">رأی‌دهندگان</th>
              <th className="px-3 py-3 text-end font-medium">دورها</th>
              <th className="px-3 py-3 text-center font-medium">منتخب</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row) => (
              <tr key={row.name} className="border-t border-line">
                <td className="px-3 py-2.5"><NameLink name={row.name} url={row.url} /></td>
                <td dir="ltr" className="px-3 py-2.5 text-end tabular-nums">{formatMoney(row.price, row.currency, row.provider != null || row.url != null)}</td>
                <td dir="ltr" className="px-3 py-2.5 text-start text-xs text-muted">{row.provider ?? "—"}</td>
                <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{row.votes}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{row.voters}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{row.rounds}</td>
                <td className="px-3 py-2.5 text-center">
                  <form action={togglePickAction}>
                    <input type="hidden" name="name" value={row.name} />
                    <button className={`text-lg leading-none ${row.picked ? "text-gold" : "text-line hover:text-gold"}`}>★</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
