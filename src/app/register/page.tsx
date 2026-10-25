import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Field, buttonClass, fieldClass } from "@/components/ui";
import { registerAction } from "@/lib/actions/auth";
import { getSession } from "@/lib/auth";
import { one } from "@/lib/format";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.nav.register };

const errors: Record<string, string> = {
  username: t.auth.err.username,
  reserved: t.auth.err.reserved,
  password: t.auth.err.password,
  taken: t.auth.err.taken,
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session?.role === "admin") redirect("/admin");
  if (session) redirect("/vote");

  const query = await searchParams;
  const error = errors[one(query.error) ?? ""];

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 sm:px-6">
      <p className="text-sm font-medium text-accent">{t.auth.registerEyebrow}</p>
      <h1 className="mt-2 font-display text-5xl">{t.auth.createAccount}</h1>
      <p className="mt-3 text-muted">{t.auth.registerLead}</p>
      <form action={registerAction} className="mt-8 grid gap-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t.auth.username} hint={t.auth.usernameHint}>
          <input name="username" dir="ltr" autoComplete="username" required minLength={3} maxLength={32} className={fieldClass} />
        </Field>
        <Field label={t.auth.password} hint={t.auth.passwordHint}>
          <input
            name="password"
            dir="ltr"
            type="password"
            autoComplete="new-password"
            required
            minLength={4}
            maxLength={72}
            className={fieldClass}
          />
        </Field>
        <button className={buttonClass()}>{t.auth.createAccount}</button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {t.auth.haveAccount}{" "}
        <Link href="/login" className="font-semibold text-ink underline decoration-line underline-offset-4">
          {t.auth.signIn}
        </Link>
      </p>
    </main>
  );
}
