import { onDataCleared } from "@/lib/data-cache";
import { browseFacets, countBrowse, parseBrowse, poolOverview, setSamples } from "@/lib/pool-browse";
import { poolFacets, poolLengthCounts } from "@/lib/pool";
import { readerThreaded } from "@/lib/ro";
import { importTags } from "@/lib/supplements";

/**
 * Fills the whole-pool aggregates (data-cache) in the background, so the first admin visit after a
 * restart or a pool change does not pay for them (~10 s locally, up to a minute on the production disk).
 * Runs one computation at a time in the reader threads, so the main thread and voter requests are not
 * blocked; a page asked for meanwhile joins the running computation instead of starting its own.
 * Only runs when reads are threaded: inline, the same queries would stall the whole server.
 */
const STEPS: Array<[string, () => Promise<unknown>]> = [
  ["poolLengthCounts", poolLengthCounts], // length pickers, voter free tab
  ["poolFacets", poolFacets], // round forms
  ["browseFacets", browseFacets], // Explore filters
  ["poolOverview", poolOverview], // pool page
  ["setSamples", () => setSamples()],
  ["importTags", importTags], // pool supplement
  ["exploreCount", () => countBrowse(parseBrowse({}))],
];

const g = globalThis as unknown as { dvWarm?: { running: boolean; again: boolean; hooked: boolean } };
const state = (g.dvWarm ??= { running: false, again: false, hooked: false });

async function run(reason: string) {
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  try {
    const started = Date.now();
    for (const [name, step] of STEPS) {
      const t = Date.now();
      try {
        await step();
      } catch (err) {
        console.error(`[warm] ${name} failed`, err);
        continue;
      }
      if (Date.now() - t > 1000) console.log(`[warm] ${name} ${Date.now() - t} ms`);
    }
    console.log(`[warm] ${reason}: caches filled in ${Date.now() - started} ms`);
  } finally {
    state.running = false;
  }
  if (state.again) {
    state.again = false;
    void run("pool changed");
  }
}

/** Start warming without waiting; never throws. Re-warms whenever the cached data is invalidated. */
export function warmCaches() {
  if (process.env.DV_WARM === "off") return;
  try {
    if (!readerThreaded()) return;
    if (!state.hooked) {
      state.hooked = true;
      onDataCleared(() => setTimeout(() => void run("pool changed").catch((err) => console.error("[warm] failed", err)), 0));
    }
  } catch (err) {
    console.error("[warm] could not start", err);
    return;
  }
  void run("startup").catch((err) => console.error("[warm] failed", err));
}
