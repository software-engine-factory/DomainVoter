"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/copy/fa";
import { AdminTour } from "@/components/admin/admin-tour";

const LINKS = [
  { href: "/admin", label: t.adminNav.rounds, exact: true, tour: "rounds" },
  { href: "/admin/rounds/new", label: t.nav.newRound, tour: "newRound" },
  { href: "/admin/pool", label: t.nav.pool, tour: "pool" },
  { href: "/admin/picks", label: t.nav.picks, tour: "picks" },
  { href: "/admin/stats", label: t.adminNav.stats, tour: "stats" },
  { href: "/admin/users", label: t.adminNav.users, tour: "users" },
  { href: "/admin/explore", label: t.adminNav.explore, tour: "explore" },
  { href: "/admin/bookmarks", label: t.adminNav.bookmarks, tour: "bookmarks" },
  { href: "/admin/rounds/batch", label: t.adminNav.batch, tour: "batch" },
  { href: "/admin/settings", label: t.adminNav.uiSettings, tour: "settings" },
];

/** Admin-only sub navigation. Lives under the main header so the shared header stays untouched. */
export function AdminNav({ user }: { user: string }) {
  const path = usePathname();
  return (
    <nav aria-label={t.adminNav.label} className="border-b border-line bg-card/60">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2 text-sm sm:px-6">
        {LINKS.map((link) => {
          const active = link.exact ? path === link.href : path === link.href || path.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              data-tour={link.tour}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-md px-3 py-1.5 ${active ? "bg-ink text-paper" : "text-muted hover:bg-card hover:text-ink"}`}
            >
              {link.label}
            </Link>
          );
        })}
        <AdminTour user={user} />
        <Link href="/vote" className="shrink-0 rounded-md px-3 py-1.5 text-accent hover:bg-card">
          {t.adminNav.backToVoting}
        </Link>
      </div>
    </nav>
  );
}
