import { getSqlite } from "@/db";
import { reader } from "@/lib/ro";

/**
 * Big round / batch writes without stalling voters. With free names in the pool one filter can match
 * ~2.3M names; a single INSERT…SELECT of that size held the main connection (and every voter request in
 * the process) for ~20 s. Instead the ordering runs in a reader thread and comes back as ONE string
 * (cheap to hand across threads), and the rows are written in short chunks with a yield between them.
 */
const CHUNK = 2000;

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

/**
 * Names in order, newline-joined. `select` must yield `name` and `rn` (its 1-based order), e.g.
 * `SELECT p.name AS name, ROW_NUMBER() OVER (ORDER BY …) AS rn FROM pool p WHERE …`.
 */
export async function orderedNames(select: string, params: readonly unknown[]): Promise<string> {
  const row = await reader().get<{ s: string | null }>(`SELECT group_concat(name, char(10) ORDER BY rn) AS s FROM (${select})`, params);
  return row?.s ?? "";
}

/** Calls `write(namesJson, offset)` for each chunk of the newline-joined list, each in its own transaction. */
export async function writeChunks(names: string, write: (json: string, offset: number) => number): Promise<number> {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(write);
  let at = 0;
  let offset = 0;
  let written = 0;
  while (at < names.length) {
    let end = at;
    for (let i = 0; i < CHUNK && end !== -1; i++) end = names.indexOf("\n", end + (i ? 1 : 0));
    const stop = end === -1 ? names.length : end;
    const part = names.slice(at, stop).split("\n");
    written += tx(JSON.stringify(part), offset);
    offset += part.length;
    at = stop + 1;
    if (at < names.length) await pause();
  }
  return written;
}

/**
 * A pool round from an ordered name list. It stays closed (hidden from voters) while the chunks are
 * written and opens at the end; a failure removes it. Returns id 0 when nothing matched.
 */
export async function createPoolRound(meta: { title: string; filterJson: string; sortMode: string }, names: string) {
  if (!names) return { id: 0, count: 0 };
  const sqlite = getSqlite();
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO rounds (title, status, parent_round_id, filter_json, sort_mode, created_at, opened_at, source)
         VALUES (?, 'closed', NULL, ?, ?, ?, NULL, 'pool')`,
      )
      .run(meta.title, meta.filterJson, meta.sortMode, Date.now()).lastInsertRowid,
  );
  const drop = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM domains WHERE round_id = ?").run(id);
    sqlite.prepare("DELETE FROM rounds WHERE id = ?").run(id);
  });
  try {
    const insert = sqlite.prepare(
      `INSERT INTO domains (round_id, position, name, price, is_premium, source_domain_id, pool_name, currency)
       SELECT ?, ? + j.key + 1, p.name, COALESCE(p.lp_price, p.best_price), 0, NULL, p.name, p.lp_currency
       FROM json_each(?) j JOIN pool p ON p.name = j.value ORDER BY j.key`,
    );
    const count = await writeChunks(names, (json, offset) => insert.run(id, offset, json).changes);
    if (count === 0) {
      drop();
      return { id: 0, count: 0 };
    }
    sqlite.prepare("UPDATE rounds SET status = 'open', opened_at = ? WHERE id = ?").run(Date.now(), id);
    return { id, count };
  } catch (error) {
    drop();
    throw error;
  }
}
