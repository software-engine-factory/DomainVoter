export function formatPrice(price: number | null) {
  if (price == null) return "—";
  const amount = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(price);
  return `${amount} دلار`;
}

export function formatWhen(value: Date | number | null | undefined) {
  if (value == null) return "";
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("fa-IR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatPercent(viewed: number, total: number) {
  if (total === 0) return 0;
  return Math.round((viewed / total) * 100);
}

export function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function withParams(path: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** Price in its original currency; pool rows without a price read "price on page". */
export function formatMoney(price: number | null, currency: string | null, fromPool: boolean) {
  if (price == null) return fromPool ? "قیمت در صفحه" : "—";
  const code = (currency ?? "USD").toUpperCase();
  if (code === "USD") return formatPrice(price);
  const amount = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(price);
  return `${amount} ${code}`;
}
