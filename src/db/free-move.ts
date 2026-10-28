import type Database from "better-sqlite3";

/**
 * Migration v14 moved free-to-register names into `pool` (avail = 'free'). The 1.9M existing rows are
 * moved here, after startup, in small name-ordered chunks: one short transaction per chunk, then a pause of
 * at least twice the chunk's own time, so the web process stays free for voters at least 2/3 of the time
 * even on a busy host, and no request waits behind more than one small chunk.
 * Idempotent and resumable: whatever is left in free_names is moved on the next start. A name already in
 * the pool (for sale) wins; its free copy is dropped.
 */
export const FREE_MOVE_CHUNK = 250;
const CHUNK = FREE_MOVE_CHUNK;
const PAUSE_MS = 25;

const COLS = "name, set_1, set_2, set_3, set_4, set_5, set4_part, shape, ord, import_tag, imported_at, cf_checked_at, reg_price_usd, reg_registrar";

type Move = { running: boolean; moved: number; chunks: number; maxMs: number; lastMs: number; startedAt: number; doneAt: number | null };
const g = globalThis as unknown as { dvFreeMove?: Move };

export function freeMoveStatus(): Move | undefined {
  return g.dvFreeMove;
}

function statements(sqlite: Database.Database) {
  const hasAvail = (sqlite.prepare("PRAGMA table_info(pool)").all() as Array<{ name: string }>).some((c) => c.name === "avail");
  const hasFree = !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'free_names'").get();
  if (!hasAvail || !hasFree) return null;
  const hi = sqlite.prepare(`SELECT max(name) AS m FROM (SELECT name FROM free_names WHERE name > ? ORDER BY name LIMIT ${CHUNK})`);
  const ins = sqlite.prepare(
    `INSERT INTO pool (${COLS}, avail) SELECT ${COLS}, 'free' FROM free_names WHERE name > ? AND name <= ? ORDER BY name ON CONFLICT(name) DO NOTHING`,
  );
  const del = sqlite.prepare("DELETE FROM free_names WHERE name > ? AND name <= ?");
  return sqlite.transaction((lo: string) => {
    const top = (hi.get(lo) as { m: string | null }).m;
    if (top == null) return null;
    const moved = ins.run(lo, top).changes;
    del.run(lo, top);
    return { top, moved };
  });
}

/** One chunk; returns the last name moved, or null when free_names is empty. */
function step(chunk: NonNullable<ReturnType<typeof statements>>, lo: string, state: Move) {
  const t0 = performance.now();
  const r = chunk(lo);
  const ms = performance.now() - t0;
  if (!r) return null;
  state.moved += r.moved;
  state.chunks += 1;
  state.maxMs = Math.max(state.maxMs, ms);
  state.lastMs = ms;
  return r.top;
}

/** Synchronous drain (tests, ops scripts). */
export function moveFreeNamesNow(sqlite: Database.Database) {
  const chunk = statements(sqlite);
  const state: Move = { running: true, moved: 0, chunks: 0, maxMs: 0, lastMs: 0, startedAt: Date.now(), doneAt: null };
  if (chunk) for (let lo: string | null = ""; lo != null; ) lo = step(chunk, lo, state);
  state.running = false;
  state.doneAt = Date.now();
  return state;
}

/** Background drain after startup (once per process). Skipped while `next build` collects pages. */
export function startFreeMove(sqlite: Database.Database) {
  if (g.dvFreeMove || process.env.NEXT_PHASE === "phase-production-build" || process.env.DV_FREE_MOVE === "off") return;
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'free_names'").get()) return;
  if (!sqlite.prepare("SELECT 1 FROM free_names LIMIT 1").get()) return;
  const chunk = statements(sqlite);
  if (!chunk) return;
  const state: Move = (g.dvFreeMove = { running: true, moved: 0, chunks: 0, maxMs: 0, lastMs: 0, startedAt: Date.now(), doneAt: null });
  console.log("[free-move] moving free_names into pool");
  let lo: string | null = "";
  let failures = 0;
  const tick = () => {
    try {
      lo = step(chunk, lo as string, state);
    } catch (error) {
      // SQLITE_BUSY from another writer (ops CLI): try the same chunk again a bit later.
      failures += 1;
      console.error(`[free-move] chunk failed (${failures})`, error);
      if (failures >= 30) {
        state.running = false; // the rest moves on the next start
        return;
      }
      setTimeout(tick, 1000).unref();
      return;
    }
    if (lo == null) {
      state.running = false;
      state.doneAt = Date.now();
      console.log(`[free-move] done: ${state.moved} names in ${state.chunks} chunks, ${state.doneAt - state.startedAt} ms, longest chunk ${state.maxMs.toFixed(0)} ms`);
      return;
    }
    setTimeout(tick, Math.max(PAUSE_MS, Math.round(state.lastMs * 2))).unref();
  };
  setTimeout(tick, 2000).unref();
}
