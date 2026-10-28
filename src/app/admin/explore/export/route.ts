import { getSession } from "@/lib/auth";
import { parseExplore } from "@/lib/explore-params";
import { iterateActivity } from "@/lib/insights";
import { iterateBrowse, parseBrowse } from "@/lib/pool-browse";

const cell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return new Response("forbidden", { status: 403 });
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  if (params.mode !== "activity") {
    const all: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (all[k] ??= []).push(v);
    // Streamed: rows come off-thread in chunks (lib/ro), so a 500k-name export never blocks voters
    // and is never held as one giant string.
    const q = parseBrowse(all);
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(enc.encode("name,price,currency,price_usd,price_source,evidence,parking_provider,ns_class,sale_url,sets,rounds,views,votes,bookmarked,avail,reg_price_usd"));
          for await (const chunk of iterateBrowse(q)) {
            if (!chunk.length) continue;
            const text = chunk
              .map((r) => [r.name, r.price, r.currency, r.priceUsd, r.source, r.evidence, r.provider, r.nsClass, r.url, r.sets, r.rounds, r.views, r.votes, r.bookmarked, r.avail, r.regPrice].map(cell).join(","))
              .join("\n");
            controller.enqueue(enc.encode("\n" + text));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="pool.csv"` },
    });
  }
  const q = { ...parseExplore(params), group: "event" as const };
  const lines = ["kind,at_iso,user,round_id,round,position,name,provider,evidence,price,currency,voted,bookmarked"];
  for (const r of iterateActivity(q)) {
    lines.push(
      [r.kind, new Date(r.at).toISOString(), r.username, r.roundId, r.roundTitle, r.position, r.name, r.provider, r.evidence, r.price, r.currency, r.voted, r.bookmarked]
        .map(cell)
        .join(","),
    );
  }
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="activity.csv"` },
  });
}
