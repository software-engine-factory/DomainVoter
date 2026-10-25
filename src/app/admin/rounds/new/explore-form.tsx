import Link from "next/link";
import { AssigneePicker, type PickerUser } from "@/components/admin/assignee-picker";
import { buttonClass, fieldClass } from "@/components/ui";
import { createExploreRoundAction } from "@/lib/actions/pool";
import { t } from "@/lib/copy/fa";

/** Round from Explore results: the filter is already chosen there, so only title and access remain. */
export function ExploreRoundForm({ explore, count, users, error }: { explore: string; count: number; users: PickerUser[]; error?: string }) {
  return (
    <form action={createExploreRoundAction} className="mt-6 grid gap-5" data-testid="explore-round">
      <input type="hidden" name="explore" value={explore} />
      {error ? <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-4">
        <p className="text-sm text-muted">{t.w4.fromExplore}</p>
        <Link href={`/admin/explore${explore ? `?${explore}` : ""}`} className={buttonClass("ghost", "sm")}>
          {t.w4.editFilters}
        </Link>
      </div>
      <label className="grid gap-1.5 text-sm font-semibold">
        {t.newRound.roundTitle}
        <input name="title" required maxLength={80} className={fieldClass} placeholder={t.newRound.poolPlaceholder} />
      </label>
      <AssigneePicker users={users} />
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-4">
        <span className="font-display text-2xl tabular-nums" data-testid="explore-count">{count.toLocaleString("fa-IR")}</span>
        <button type="submit" disabled={count === 0} className={buttonClass("primary")}>
          {t.w4.create}
        </button>
      </div>
    </form>
  );
}
