import { getSession } from "@/lib/auth";
import { getRound, iterateRoundRows } from "@/lib/rounds";
import { t } from "@/lib/copy/fa";

function cell(value: string | number | null) {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return new Response(t.export.err.login, { status: 401 });
  }

  const { id } = await context.params;
  const round = getRound(Number(id));
  if (!round) return new Response(t.export.err.notFound, { status: 404 });

  const pool = round.source === "pool";
  const header = pool
    ? "\uFEFF" + t.export.headerPool
    : "\uFEFF" + t.export.headerCsv;
  const rows = iterateRoundRows(round.id);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(header + "\n"));
    },
    pull(controller) {
      const chunk: string[] = [];
      for (let i = 0; i < 2000; i++) {
        const next = rows.next();
        if (next.done) {
          if (chunk.length) controller.enqueue(encoder.encode(chunk.join("\n") + "\n"));
          controller.close();
          return;
        }
        const d = next.value;
        chunk.push(
          (pool
            ? [d.position, cell(d.name), d.price ?? "", cell(d.currency), cell(d.marketplace), cell(d.provider), cell(d.nsClass), cell(d.evidence), cell(d.url), d.picked ? t.common.yes : "", d.votes, d.viewers]
            : [d.position, cell(d.name), d.price ?? "", d.isPremium ? t.common.yes : t.common.no, d.votes, d.viewers]
          ).join(","),
        );
      }
      controller.enqueue(encoder.encode(chunk.join("\n") + "\n"));
    },
    cancel() {
      rows.return?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="round-${round.id}-results.csv"`,
    },
  });
}
