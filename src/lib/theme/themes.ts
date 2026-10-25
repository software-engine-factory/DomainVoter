import { t } from "@/lib/copy/fa";
// Add a theme: append here and add a matching [data-theme] block in src/styles/themes.css.
export const THEMES = [
  { id: "kahroba", label: t.theme.kahroba, swatch: ["#f3efe6", "#085041", "#6d4d12"] },
  { id: "firoozeh", label: t.theme.firoozeh, swatch: ["#eaf6f7", "#0b7285", "#c2410c"] },
  { id: "jowhar", label: t.theme.jowhar, swatch: ["#ffffff", "#111111", "#ff4d00"] },
  { id: "violet", label: t.theme.violet, swatch: ["#0b0c14", "#9b8cff", "#e0457b"] },
  { id: "emerald", label: t.theme.emerald, swatch: ["#07110f", "#e8c27a", "#0f5a4a"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "kahroba";
export const THEME_COOKIE = "dv-theme";
export const THEME_STORAGE_KEY = "dv-theme";

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}
