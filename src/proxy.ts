import { NextResponse, type NextRequest } from "next/server";
import { canSeeRound } from "@/lib/assignees";
import { SESSION_COOKIE, sessionFromToken } from "@/lib/auth";
import { t } from "@/lib/copy/fa";

/**
 * A round assigned to other people must answer a real 404 on direct URLs. The page itself also calls
 * notFound(), but /vote/[roundId] streams (loading.tsx), so its status is already 200 by then.
 * Signed-out requests pass through and the page redirects them to /login as before.
 */
export function proxy(request: NextRequest) {
  const roundId = Number(request.nextUrl.pathname.split("/")[2]);
  const session = sessionFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session || !Number.isInteger(roundId) || canSeeRound(roundId, session.userId)) return NextResponse.next();
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${t.hidden.title}</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f4efe6;color:#1d1a16;text-align:center"><main><h1 style="font-size:1.5rem">${t.hidden.title}</h1><p style="color:#6b645a">${t.hidden.body}</p><p><a href="/vote" style="color:#0b4a3c">${t.hidden.back}</a></p></main></body></html>`;
  return new NextResponse(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const config = { matcher: ["/vote/:roundId(\\d+)"] };
