import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth";
import type { SessionUser } from "@/lib/auth";
import { NavLink } from "@/components/nav-link";
import { ThemePicker } from "@/components/theme-picker";
import { buttonClass } from "@/components/ui";
import type { ThemeId } from "@/lib/theme/themes";

export function Header({ session, theme }: { session: SessionUser | null; theme: ThemeId }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2"
      >
        پرش به محتوا
      </a>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0 sm:px-6">
        <Link href="/" className="group inline-flex items-center gap-2 font-display text-[1.65rem] leading-none text-ink">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent transition-transform duration-300 group-hover:rotate-45" aria-hidden />
          رأی دامنه
        </Link>
        <div className="flex shrink-0 items-center gap-1.5 sm:order-last">
          <ThemePicker initial={theme} />
          {session ? (
            <form action={logoutAction} className="flex items-center gap-2">
              <span dir="ltr" className="hidden text-sm text-muted md:inline">
                {session.username}
              </span>
              <button className={buttonClass("ghost", "sm")}>خروج</button>
            </form>
          ) : null}
        </div>
        <div className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-x-3 overflow-x-auto px-4 pb-1 text-sm [scrollbar-width:none] sm:order-none sm:mx-0 sm:me-auto sm:w-auto sm:overflow-visible sm:px-0 sm:pb-0">
          <nav className="flex shrink-0 items-center gap-1 sm:gap-3" aria-label="اصلی">
            {session?.role === "admin" ? (
              <>
                <NavLink href="/admin" exact>
                  دورها
                </NavLink>
                <NavLink href="/admin/rounds/new">دور جدید</NavLink>
                <NavLink href="/admin/pool">استخر فروشی</NavLink>
                <NavLink href="/admin/picks">منتخب‌ها</NavLink>
              </>
            ) : session ? (
              <NavLink href="/vote" exact>
                دورها
              </NavLink>
            ) : (
              <>
                <NavLink href="/login" exact>
                  ورود
                </NavLink>
                <NavLink href="/register" exact>
                  ثبت‌نام
                </NavLink>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
