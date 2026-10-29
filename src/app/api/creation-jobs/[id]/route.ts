import { getSession } from "@/lib/auth";
import { changeCreationJob, creationSnapshot, getCreationJob, startCreationJob, sameCreationOrigin } from "@/lib/creation-jobs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const row = getCreationJob(id, session.userId);
  if (!row) return Response.json({ error: "not_found" }, { status: 404 });
  startCreationJob(id);
  return Response.json(creationSnapshot(row), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  if (!sameCreationOrigin(request)) return Response.json({ error: "origin" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body?.action !== "cancel" && body?.action !== "retry") return Response.json({ error: "invalid_action" }, { status: 400 });
  try {
    if (!changeCreationJob(id, session.userId, body.action)) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "capacity" }, { status: 429, headers: { "Retry-After": "3" } });
  }
}
