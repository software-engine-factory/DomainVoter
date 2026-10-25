// Add a theme: append here and add a matching [data-theme] block in src/styles/themes.css.
export const THEMES = [
  { id: "firoozeh", label: "فیروزه", swatch: ["#eaf6f7", "#0b7285", "#c2410c"] },
  { id: "jowhar", label: "جوهر", swatch: ["#ffffff", "#111111", "#ff4d00"] },
  { id: "violet", label: "بنفش شیشه‌ای", swatch: ["#0b0c14", "#9b8cff", "#e0457b"] },
  { id: "emerald", label: "زمرد و طلا", swatch: ["#07110f", "#e8c27a", "#0f5a4a"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "firoozeh";
export const THEME_COOKIE = "dv-theme";
export const THEME_STORAGE_KEY = "dv-theme";

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}
