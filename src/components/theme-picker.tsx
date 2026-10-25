"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES, THEME_COOKIE, THEME_STORAGE_KEY, isTheme, type ThemeId } from "@/lib/theme/themes";

function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {}
  document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
  window.setTimeout(() => root.classList.remove("theme-switching"), 450);
}

export function ThemePicker({ initial }: { initial: ThemeId }) {
  const [theme, setTheme] = useState<ThemeId>(initial);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {}
    if (isTheme(stored) && stored !== initial) {
      applyTheme(stored);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(stored);
    }
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = THEMES.find((item) => item.id === theme) ?? THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="پوسته"
        onClick={() => setOpen((value) => !value)}
        className="press inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 text-xs font-semibold text-ink transition hover:border-accent/40"
      >
        <span className="flex -space-x-1 rtl:space-x-reverse" aria-hidden>
          {current.swatch.map((color) => (
            <span key={color} className="size-3 rounded-full ring-2 ring-card" style={{ background: color }} />
          ))}
        </span>
        <span className="hidden sm:inline">{current.label}</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="پوسته"
          className="pop-in absolute end-0 top-11 z-40 grid w-44 gap-1 rounded-2xl border border-line bg-card p-1.5 shadow-xl shadow-ink/10"
        >
          {THEMES.map((item, index) => (
            <li key={item.id} style={{ animationDelay: `${index * 30}ms` }} className="stagger-in">
              <button
                type="button"
                role="option"
                aria-selected={item.id === theme}
                onClick={() => {
                  applyTheme(item.id);
                  setTheme(item.id);
                  setOpen(false);
                }}
                className={`press flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition ${
                  item.id === theme ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-paper"
                }`}
              >
                <span className="flex -space-x-1 rtl:space-x-reverse" aria-hidden>
                  {item.swatch.map((color) => (
                    <span key={color} className="size-3.5 rounded-full ring-2 ring-card" style={{ background: color }} />
                  ))}
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
