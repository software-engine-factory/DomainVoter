/**
 * Runs once when a server instance starts. Fills the whole-pool caches in the background (lib/warm) so
 * the first admin page after a deploy or restart is not the one paying for them. Not awaited: startup
 * and /health are not delayed, and a warm-up failure only logs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { warmCaches } = await import("@/lib/warm");
  setTimeout(warmCaches, 0);
}
