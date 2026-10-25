export const THEMES = [
  { id: "kahroba", label: "کهربا", swatch: ["#f3efe6", "#085041", "#6d4d12"] },
  { id: "shab", label: "شب", swatch: ["#12151a", "#4fd1a5", "#e8b75c"] },
  { id: "firoozeh", label: "فیروزه", swatch: ["#eaf6f7", "#0b7285", "#c2410c"] },
  { id: "anar", label: "انار", swatch: ["#fbf1ee", "#b42335", "#7c3aed"] },
  { id: "jowhar", label: "جوهر", swatch: ["#ffffff", "#111111", "#ff4d00"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "kahroba";
export const THEME_COOKIE = "dv-theme";
export const THEME_STORAGE_KEY = "dv-theme";

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}
