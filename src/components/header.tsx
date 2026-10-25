import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth";
import type { SessionUser } from "@/lib/auth";
import { NavLink } from "@/components/nav-link";
import { buttonClass } from "@/components/ui";
import { t } from "@/lib/copy/fa";

export function Header({ session }: { session: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2"
      >
        {t.nav.skip}
      </a>
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-x-6 px-4 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-2 font-display text-[1.65rem] leading-none text-ink">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden />
          {t.app.name}
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <nav className="flex items-center gap-5" aria-label={t.nav.main}>
            {session?.role === "admin" ? (
              <>
                <NavLink href="/admin" exact>
                  {t.nav.rounds}
                </NavLink>
                <NavLink href="/admin/rounds/new">{t.nav.newRound}</NavLink>
                <NavLink href="/admin/pool">{t.nav.pool}</NavLink>
                <NavLink href="/admin/picks">{t.nav.picks}</NavLink>
              </>
            ) : session ? (
              <NavLink href="/vote" exact>
                {t.nav.rounds}
              </NavLink>
            ) : (
              <>
                <NavLink href="/login" exact>
                  {t.nav.login}
                </NavLink>
                <NavLink href="/register" exact>
                  {t.nav.register}
                </NavLink>
              </>
            )}
          </nav>
          {session ? (
            <form action={logoutAction} className="flex items-center gap-3">
              <span dir="ltr" className="text-muted">
                {session.username}
              </span>
              <button className={buttonClass("ghost")}>{t.nav.logout}</button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}
