"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/copy/fa";

type NavItem = { href: string; label: string; tour: string; exact?: boolean };

/** Grouped so the whole menu wraps into a few tidy rows instead of scrolling sideways. */
const GROUPS: NavItem[][] = [
  [
    { href: "/admin", label: t.adminNav.rounds, exact: true, tour: "rounds" },
    { href: "/admin/rounds/new", label: t.nav.newRound, tour: "newRound" },
    { href: "/admin/rounds/batch", label: t.adminNav.batch, tour: "batch" },
  ],
  [
    { href: "/admin/pool", label: t.nav.pool, tour: "pool" },
    { href: "/admin/free", label: t.free.nav, tour: "free" },
    { href: "/admin/picks", label: t.nav.picks, tour: "picks" },
    { href: "/admin/bookmarks", label: t.adminNav.bookmarks, tour: "bookmarks" },
  ],
  [
    { href: "/admin/stats", label: t.adminNav.stats, tour: "stats" },
    { href: "/admin/explore", label: t.adminNav.explore, tour: "explore" },
    { href: "/admin/users", label: t.adminNav.users, tour: "users" },
    { href: "/admin/settings", label: t.adminNav.uiSettings, tour: "settings" },
  ],
];

const chip =
  "press shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] leading-6 transition-colors duration-200 sm:px-3 sm:text-sm";

/** Admin-only sub navigation. Lives under the main header so the shared header stays untouched. */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label={t.adminNav.label} className="border-b border-line bg-card/60">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-1 gap-y-1 px-3 py-2 sm:px-6">
        {GROUPS.map((group, gi) => (
          <div key={gi} className="flex flex-wrap items-center gap-0.5">
            {gi > 0 ? <span aria-hidden className="mx-1 hidden h-4 w-px bg-line sm:block" /> : null}
            {group.map((link) => {
              const active = link.exact ? path === link.href : path === link.href || path.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  data-tour={link.tour}
                  aria-current={active ? "page" : undefined}
                  className={`${chip} ${active ? "bg-ink text-paper" : "text-muted hover:bg-card hover:text-ink"}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}
        <Link
          href="/vote"
          title={t.adminNav.backToVoting}
          className={`${chip} ms-auto text-accent hover:bg-card`}
        >
          {t.adminNav.backToVoting}

        </Link>
      </div>
    </nav>
  );
}
