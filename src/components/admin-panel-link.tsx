"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { t } from "@/lib/copy/fa";

/** On admin screens the sub-nav already covers this, so it steps aside on mobile to keep the header on one row. */
export function AdminPanelLink() {
  const inAdmin = usePathname().startsWith("/admin");
  return (
    <Link
      href="/admin"
      className={`${buttonClass("secondary", "sm")} h-8 whitespace-nowrap px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm ${inAdmin ? "max-sm:hidden" : ""}`}
    >
      {t.nav.adminPanel}
    </Link>
  );
}
