import type { Metadata } from "next";
import { requireVoter } from "@/lib/auth";
import { listMyBookmarks } from "@/lib/my-bookmarks";
import { t } from "@/lib/copy/fa";
import { MyBookmarks } from "./my-bookmarks";

export const metadata: Metadata = { title: t.myBookmarks.title };
export const dynamic = "force-dynamic";

export default async function MyBookmarksPage() {
  const session = await requireVoter();
  const items = listMyBookmarks(session.userId);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-display text-4xl sm:text-5xl">{t.myBookmarks.title}</h1>
      <MyBookmarks initial={items} />
    </main>
  );
}
