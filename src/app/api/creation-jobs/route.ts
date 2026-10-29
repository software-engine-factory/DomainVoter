import { getSession } from "@/lib/auth";
import { creationInput } from "@/lib/creation-input";
import { acceptCreationJob, sameCreationOrigin } from "@/lib/creation-jobs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  if (!sameCreationOrigin(request)) return Response.json({ error: "origin" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 64_000) return Response.json({ error: "input_too_large" }, { status: 413 });
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[\w-]{16,80}$/.test(key)) return Response.json({ error: "invalid_key" }, { status: 400 });
  try {
    const form = await request.formData();
    const input = creationInput(form, String(form.get("kind")));
    const id = acceptCreationJob(session.userId, key, input);
    return Response.json({ id, statusUrl: `/admin/creation-jobs/${id}` }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const code = e instanceof Error ? e.message : "invalid_input";
    const status = code === "capacity" ? 429 : code === "idempotency_conflict" ? 409 : 400;
    return Response.json({ error: status === 400 ? "invalid_input" : code }, { status, headers: status === 429 ? { "Retry-After": "3" } : undefined });
  }
}
