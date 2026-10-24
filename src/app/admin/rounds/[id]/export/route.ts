import { getSession } from "@/lib/auth";
import { getDomainStats, getRound } from "@/lib/rounds";

function cell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return new Response("برای خروجی گرفتن با حساب مدیر وارد شوید.", { status: 401 });
  }

  const { id } = await context.params;
  const round = getRound(Number(id));
  if (!round) return new Response("دور پیدا نشد.", { status: 404 });

  const lines = ["\uFEFFردیف,دامنه,قیمت,پریمیوم,آرا,بازدیدکنندگان"];
  for (const domain of getDomainStats(round.id)) {
    lines.push(
      [
        domain.position,
        cell(domain.name),
        domain.price ?? "",
        domain.isPremium ? "بله" : "خیر",
        domain.votes,
        domain.viewers,
      ].join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="round-${round.id}-results.csv"`,
    },
  });
}
