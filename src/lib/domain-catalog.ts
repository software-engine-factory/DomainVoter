import { getSqlite } from "@/db";

export type CatalogDomain = {
  id: number; roundId: number; position: number; name: string;
  price: number | null; currency: string | null;
};

/** Negative IDs identify frozen selection items. Old positive IDs remain unchanged. */
export function catalogDomain(id: number): CatalogDomain | undefined {
  return getSqlite().prepare(`SELECT id, round_id AS roundId, position, name, price, currency
    FROM domain_catalog WHERE id = ?`).get(id) as CatalogDomain | undefined;
}

/** Allocate FK targets only for names actually interacted with, after the caller checks access. */
export function materializeDomains(roundId: number, ids: number[]) {
  const negative = [...new Set(ids.filter(id => Number.isSafeInteger(id) && id < 0))].slice(0, 100);
  if (!negative.length) return;
  const sql = getSqlite();
  sql.prepare(`INSERT OR IGNORE INTO domains
    (id, round_id, position, name, price, is_premium, source_domain_id, pool_name, currency, segment)
    SELECT id, round_id, position, name, price, is_premium, source_domain_id, pool_name, currency, segment
    FROM domain_catalog WHERE round_id = ? AND id IN (${negative.map(() => "?").join(",")})`)
    .run(roundId, ...negative);
}
