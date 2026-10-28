// Times the app's own browse/facet functions against a DB copy (DATA_DIR=/w). Read-mostly; run on a COPY only.
import { browseFree, browseFreeForVoters, freeLengthCounts, parseFreeQuery } from "@/lib/free-names";
import { browsePool, browseFacets, parseBrowse, poolOverview } from "@/lib/pool-browse";
import { poolFacets, poolLengthCounts, emptyPoolFilters, countPool } from "@/lib/pool";
import { importTags } from "@/lib/supplements";
import { getSqlite } from "@/db";
const out: Record<string, unknown>[] = [];
function t(label: string, fn: () => unknown, reps = 3) {
  const ms: number[] = []; let info: unknown;
  for (let i = 0; i < reps; i++) { const s = performance.now(); const r = fn() as { total?: number; pages?: number; rows?: unknown[] } | null; ms.push(+(performance.now() - s).toFixed(1));
    info = r && typeof r === "object" ? ("total" in r ? { total: r.total, pages: r.pages, rows: r.rows?.length } : Array.isArray(r) ? { n: r.length } : undefined) : r; }
  out.push({ label, ms, info });
}
const db0 = getSqlite();
if (process.env.CACHE_KB) db0.pragma(`cache_size = -${process.env.CACHE_KB}`);
if (process.env.MMAP_MB) db0.pragma(`mmap_size = ${Number(process.env.MMAP_MB) * 1048576}`);
t("free len counts", () => freeLengthCounts());
t("admin/free p1", () => browseFree(parseFreeQuery({})));
t("admin/free p100", () => browseFree(parseFreeQuery({ page: "100" })));
t("admin/free last page", () => browseFree(parseFreeQuery({ page: "999999" })));
t("admin/free len5 p1", () => browseFree(parseFreeQuery({ len: "5" })));
t("admin/free len5 set1 p1", () => browseFree(parseFreeQuery({ len: "5", set: "1" })));
t("admin/free search q=ab", () => browseFree(parseFreeQuery({ q: "ab" })));
t("admin/free search q=zzq", () => browseFree(parseFreeQuery({ q: "zzq" })));
t("vote/free p1", () => browseFreeForVoters(parseFreeQuery({})));
t("vote/free len5 p1", () => browseFreeForVoters(parseFreeQuery({ len: "5" })));
t("vote/free len5 last", () => browseFreeForVoters(parseFreeQuery({ len: "5", page: "999999" })));
t("pool browse default", () => browsePool(parseBrowse({})));
t("pool browse lmin5 lmax5", () => browsePool(parseBrowse({ lmin: "5", lmax: "5" })));
t("pool browse lmin5 p2000", () => browsePool(parseBrowse({ lmin: "5", lmax: "5", page: "2000" })));
t("pool browse q=ab sort=price", () => browsePool(parseBrowse({ q: "ab", sort: "price_asc" })));
t("pool browseFacets", () => browseFacets(), 2);
t("pool poolOverview", () => poolOverview(), 2);
t("pool poolFacets", () => poolFacets(), 2);
t("pool lengthCounts", () => poolLengthCounts());
t("pool countPool(empty)", () => countPool(emptyPoolFilters()));
t("importTags", () => importTags());
console.log(JSON.stringify(out));
