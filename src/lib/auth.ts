import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type Role = "admin" | "voter";

export type SessionUser = {
  userId: number;
  username: string;
  role: Role;
};

type SessionPayload = SessionUser & { exp: number };

const COOKIE = "dv_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function secret() {
  const dataDir = path.join(process.cwd(), "data");
  const file = path.join(dataDir, "session.secret");
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return fs.readFileSync(file, "utf8");
}

function sign(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function readToken(token: string): SessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    if (payload.role !== "admin" && payload.role !== "voter") return null;
    if (!Number.isInteger(payload.userId) || typeof payload.username !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const payload = readToken(token);
  if (!payload) return null;
  return { userId: payload.userId, username: payload.username, role: payload.role };
}

export async function setSession(user: SessionUser) {
  const jar = await cookies();
  jar.set(COOKIE, sign({ ...user, exp: Date.now() + MAX_AGE_SECONDS * 1000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/vote");
  return session;
}

export async function requireVoter() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "voter") redirect("/admin");
  return session;
}
