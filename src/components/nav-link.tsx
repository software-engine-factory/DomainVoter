"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, exact = false }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "press whitespace-nowrap rounded-full bg-card px-3 py-1 font-semibold text-ink shadow-sm shadow-ink/5 ring-1 ring-accent/15"
          : "press whitespace-nowrap rounded-full px-3 py-1 text-muted hover:bg-card/70 hover:text-ink"
      }
    >
      {children}
    </Link>
  );
}
