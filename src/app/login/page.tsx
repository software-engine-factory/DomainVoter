import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Field, buttonClass, fieldClass } from "@/components/ui";
import { loginAction } from "@/lib/actions/auth";
import { getSession } from "@/lib/auth";
import { one } from "@/lib/format";
import { t } from "@/lib/copy/fa";

export const metadata: Metadata = { title: t.nav.login };

const errors: Record<string, string> = {
  invalid: t.auth.invalid,
};

export default async function LoginPage({
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
      <p className="text-sm font-medium text-accent">{t.auth.loginEyebrow}</p>
      <h1 className="mt-2 font-display text-5xl">{t.nav.login}</h1>
      <p className="mt-3 text-muted">{t.auth.loginLead}</p>
      <form action={loginAction} className="mt-8 grid gap-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t.auth.username}>
          <input name="username" dir="ltr" autoComplete="username" required className={fieldClass} />
        </Field>
        <Field label={t.auth.password}>
          <input name="password" dir="ltr" type="password" autoComplete="current-password" required className={fieldClass} />
        </Field>
        <button className={buttonClass()}>{t.nav.login}</button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {t.auth.noAccount}{" "}
        <Link href="/register" className="font-semibold text-ink underline decoration-line underline-offset-4">
          {t.auth.signUp}
        </Link>
      </p>
    </main>
  );
}
