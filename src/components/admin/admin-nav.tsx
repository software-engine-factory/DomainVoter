"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/copy/fa";

const LINKS = [
  { href: "/admin", label: t.adminNav.rounds, exact: true },
  { href: "/admin/stats", label: t.adminNav.stats },
  { href: "/admin/users", label: t.adminNav.users },
  { href: "/admin/explore", label: t.adminNav.explore },
  { href: "/admin/bookmarks", label: t.adminNav.bookmarks },
  { href: "/admin/rounds/batch", label: t.adminNav.batch },
];

/** Admin-only sub navigation. Lives under the main header so the shared header stays untouched. */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label={t.adminNav.label} className="border-b border-line bg-card/60">
      <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 py-2 text-sm sm:px-6">
        {LINKS.map((link) => {
          const active = link.exact ? path === link.href : path === link.href || path.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-md px-3 py-1.5 ${active ? "bg-ink text-paper" : "text-muted hover:bg-card hover:text-ink"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
