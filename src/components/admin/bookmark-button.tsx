import { buttonClass } from "@/components/ui";
import { toggleBookmarkAction } from "@/lib/actions/bookmarks";
import { t } from "@/lib/copy/fa";

/** Admin-private star. Voters never see it and are not notified. */
export function BookmarkButton({ name, on, sourceUserId, back }: { name: string; on: boolean; sourceUserId?: number; back: string }) {
  return (
    <form action={toggleBookmarkAction}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="back" value={back} />
      {sourceUserId ? <input type="hidden" name="sourceUserId" value={sourceUserId} /> : null}
      <button
        className={buttonClass(on ? "secondary" : "ghost", "sm")}
        aria-pressed={on}
        title={on ? t.bookmark.remove : t.bookmark.add}
      >
        {on ? "★" : "☆"}
      </button>
    </form>
  );
}
