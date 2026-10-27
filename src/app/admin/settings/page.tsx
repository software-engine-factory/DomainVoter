import type { Metadata } from "next";
import { buttonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { saveVoterFreeTabAction, saveVotePageSizeAction } from "@/lib/actions/settings";
import { getVoterFreeTab, getVotePageSize } from "@/lib/settings";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@/lib/vote-view";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.uiSettings.title };
export const dynamic = "force-dynamic";

export default async function UiSettingsPage() {
  await requireAdmin(); // layout checks too, but pages render in parallel with it
  const size = getVotePageSize();
  const freeTab = getVoterFreeTab();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{t.uiSettings.title}</h1>

      <form action={saveVotePageSizeAction} className="mt-6 rounded-xl border border-line bg-card p-4 sm:p-5">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">{t.uiSettings.perPage}</legend>
          <p className="mt-1 text-xs text-muted">{t.uiSettings.perPageHint}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {PAGE_SIZES.map((n) => (
              <label
                key={n}
                className="press relative flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-line bg-paper px-2 py-3 text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40"
              >
                <input type="radio" name="size" value={n} defaultChecked={n === size} className="sr-only" />
                <span className="text-2xl font-semibold tabular-nums">{n}</span>
                <span className="text-xs text-muted">
                  {t.uiSettings.option(n)}
                  {n === DEFAULT_PAGE_SIZE ? ` · ${t.uiSettings.isDefault}` : ""}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{t.uiSettings.current(size)}</p>
          <button className={buttonClass("primary", "sm")}>{t.uiSettings.save}</button>
        </div>
      </form>

      <form action={saveVoterFreeTabAction} className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-4 sm:p-5" data-testid="free-tab-setting">
        <p className="text-sm font-semibold text-ink" title={t.free.tabSettingTip}>{t.free.tabSetting}</p>
        <input type="hidden" name="on" value={freeTab ? "0" : "1"} />
        <button
          role="switch"
          aria-checked={freeTab}
          title={t.free.tabSettingTip}
          className={`${buttonClass(freeTab ? "primary" : "secondary", "sm")} min-w-20`}
        >
          {freeTab ? t.free.tabOn : t.free.tabOff}
        </button>
      </form>
    </main>
  );
}
