"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Copies each column header into its cells as data-label so CSS can render
// tables as stacked cards on small screens without touching page markup.
export function ResponsiveTables() {
  const pathname = usePathname();
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>("main table").forEach((table) => {
        table.classList.add("rt");
        const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
        table.querySelectorAll("tbody tr").forEach((row) => {
          Array.from(row.children).forEach((cell, index) => {
            if (heads[index] && !cell.hasAttribute("data-label")) cell.setAttribute("data-label", heads[index]);
          });
        });
      });
    };
    label();
    const observer = new MutationObserver(label);
    const main = document.querySelector("main");
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}
