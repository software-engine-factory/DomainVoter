import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { withParams } from "@/lib/format";

export function Pager({ path, params, page, pages }: { path: string; params: Record<string, string | number | undefined>; page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-2 text-sm">
      {page > 1 ? <Link className={buttonClass("ghost", "sm")} href={withParams(path, { ...params, page: page - 1 })}>قبلی</Link> : null}
      <span className="tabular-nums text-muted">{page} / {pages}</span>
      {page < pages ? <Link className={buttonClass("ghost", "sm")} href={withParams(path, { ...params, page: page + 1 })}>بعدی</Link> : null}
    </div>
  );
}
