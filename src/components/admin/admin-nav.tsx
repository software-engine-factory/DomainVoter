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
  "press shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] leading-6 transition-colors duration-200 sm:px-2.5 sm:text-sm xl:px-3";

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
          aria-label={t.adminNav.backToVoting}
          className={`${chip} group ms-auto inline-flex items-center gap-1 text-accent hover:bg-card`}
        >
          <span className="hidden lg:inline">{t.adminNav.backToVoting}</span>
          <svg viewBox="0 0 24 24" className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}
