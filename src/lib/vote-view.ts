/**
 * The voter grid's view state (page size, page, filters, position range), shared by the server page,
 * the cards API and the client board. Everything here is pure so it runs on both sides.
 */
export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;
/** Max characters in the per-position pattern (domain labels longer than this are still matched by prefix). */
export const PATTERN_MAX = 16;
export const QUERY_MAX = 40;

export type VoteView = {
  from: number | null; // 1-based position range inside the round (null = whole round)
  to: number | null;
  size: PageSize;
  page: number;
  q: string; // contains-search, normalized to Latin lower case
  pat: string; // per-position pattern; "_" = any character
  exact: boolean; // label length must equal pat.length
};

// Persian (standard ISIRI 9147) keyboard → the Latin key in the same place, so a user who forgot to
// switch layouts still gets the letter they meant. Persian/Arabic digits map to ASCII digits.
const FA_KEYS: Record<string, string> = {
  ض: "q", ص: "w", ث: "e", ق: "r", ف: "t", غ: "y", ع: "u", ه: "i", خ: "o", ح: "p",
  ش: "a", س: "s", ی: "d", ي: "d", ب: "f", ل: "g", ا: "h", آ: "h", ت: "j", ن: "k", م: "l",
  ظ: "z", ط: "x", ز: "c", ر: "v", ذ: "b", د: "n", پ: "m",
  "‌": "", "ـ": "-",
};

/** One typed character → a Latin domain character, or "" if it can't be part of a domain label. */
export function toDomainChar(raw: string): string {
  let ch = raw.toLowerCase();
  const code = ch.charCodeAt(0);
  if (code >= 0x06f0 && code <= 0x06f9) ch = String(code - 0x06f0);
  else if (code >= 0x0660 && code <= 0x0669) ch = String(code - 0x0660);
  else if (ch in FA_KEYS) ch = FA_KEYS[ch];
  return /^[a-z0-9-]$/.test(ch) ? ch : "";
}

/** Free text → Latin domain text (keeps dots so "ab.com" works). */
export function normalizeQuery(raw: string): string {
  let out = "";
  for (const ch of raw.trim()) {
    if (ch === "." || ch === "٫") out += ".";
    else out += toDomainChar(ch);
  }
  return out.slice(0, QUERY_MAX);
}

/** Pattern from the URL / slots: any non-domain char becomes "_" (any), trailing blanks dropped unless exact. */
export function normalizePattern(raw: string, exact: boolean): string {
  const chars = [...raw.slice(0, PATTERN_MAX)].map((ch) => (ch === "_" || ch === " " || ch === "?" ? "_" : toDomainChar(ch) || "_"));
  let pat = chars.join("");
  if (!exact) pat = pat.replace(/_+$/, "");
  return pat;
}

export function patternActive(pat: string, exact: boolean) {
  return exact ? pat.length > 0 : /[^_]/.test(pat);
}

export function hasFilters(view: Pick<VoteView, "q" | "pat" | "exact">) {
  return view.q !== "" || patternActive(view.pat, view.exact);
}

function int(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

type ParamGetter = (key: string) => string | null | undefined;

export function parseView(get: ParamGetter): VoteView {
  const sizeIn = int(get("size"));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeIn ?? 0) ? (sizeIn as PageSize) : DEFAULT_PAGE_SIZE;
  const exact = get("exact") === "1";
  const pat = normalizePattern(get("pat") ?? "", exact);
  return {
    from: int(get("from")),
    to: int(get("to")),
    size,
    page: Math.max(1, int(get("page")) ?? 1),
    q: normalizeQuery(get("q") ?? ""),
    pat,
    exact: exact && pat.length > 0,
  };
}

/** Stable string for cache keys and URLs. */
export function viewParams(view: VoteView): URLSearchParams {
  const p = new URLSearchParams();
  if (view.from != null) p.set("from", String(view.from));
  if (view.to != null) p.set("to", String(view.to));
  if (view.size !== DEFAULT_PAGE_SIZE) p.set("size", String(view.size));
  p.set("page", String(view.page));
  if (view.q) p.set("q", view.q);
  if (patternActive(view.pat, view.exact)) {
    p.set("pat", view.pat);
    if (view.exact) p.set("exact", "1");
  }
  return p;
}

/** Clamp a typed page number into 1..pages (bad input stays on the current page). */
export function clampPage(raw: string, current: number, pages: number): number {
  const n = int(normalizeDigits(raw));
  if (n == null) return current;
  return Math.min(Math.max(n, 1), Math.max(1, pages));
}

export function normalizeDigits(raw: string) {
  return raw.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
}
