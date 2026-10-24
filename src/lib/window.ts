export const VOTE_PAGE_SIZE = 20;

export function resolveWindow(
  total: number,
  fromValue: string | undefined,
  toValue: string | undefined,
  pageValue: string | undefined,
) {
  if (total <= 0) {
    return { from: 1, to: 0, page: 1, pages: 1, start: 1, end: 0 };
  }

  const fromInput = fromValue ? Number(fromValue) : 1;
  const toInput = toValue ? Number(toValue) : total;
  let from = Number.isFinite(fromInput) ? Math.floor(fromInput) : 1;
  let to = Number.isFinite(toInput) ? Math.floor(toInput) : total;
  from = Math.min(Math.max(from, 1), total);
  to = Math.min(Math.max(to, 1), total);
  if (to < from) to = from;

  const pages = Math.max(1, Math.ceil((to - from + 1) / VOTE_PAGE_SIZE));
  const pageInput = pageValue ? Number(pageValue) : 1;
  const page = Math.min(Math.max(Number.isFinite(pageInput) ? Math.floor(pageInput) : 1, 1), pages);
  const start = from + (page - 1) * VOTE_PAGE_SIZE;
  const end = Math.min(to, start + VOTE_PAGE_SIZE - 1);
  return { from, to, page, pages, start, end };
}
