import { getSession } from "@/lib/auth";
import { parseExplore } from "@/lib/explore-params";
import { iterateActivity } from "@/lib/insights";

const cell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return new Response("forbidden", { status: 403 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
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
