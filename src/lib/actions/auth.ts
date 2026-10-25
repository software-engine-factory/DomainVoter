"use server";

import { compareSync, hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { clearSession, setSession } from "@/lib/auth";

const USERNAME = /^[a-z0-9_]{3,32}$/;

export async function registerAction(formData: FormData) {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!USERNAME.test(username)) redirect("/register?error=username");
  if (username === "admin") redirect("/register?error=reserved");
  if (password.length < 4 || password.length > 72) redirect("/register?error=password");

  const existing = getDb().select().from(users).where(eq(users.username, username)).get();
  if (existing) redirect("/register?error=taken");

  getDb()
    .insert(users)
    .values({
      username,
      passwordHash: hashSync(password, 10),
      role: "voter",
      createdAt: new Date(),
    })
    .run();

  const created = getDb().select().from(users).where(eq(users.username, username)).get();
  if (!created) redirect("/register?error=taken");

  await setSession({ userId: created.id, username: created.username, role: "voter" });
  redirect("/vote");
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = getDb().select().from(users).where(eq(users.username, username)).get();
  if (!user || !compareSync(password, user.passwordHash)) {
    redirect("/login?error=invalid");
  }

  await setSession({ userId: user.id, username: user.username, role: user.role });
  redirect("/vote");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
