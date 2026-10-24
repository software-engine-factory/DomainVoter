import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Field, buttonClass, fieldClass } from "@/components/ui";
import { registerAction } from "@/lib/actions/auth";
import { getSession } from "@/lib/auth";
import { one } from "@/lib/format";

export const metadata: Metadata = { title: "ثبت‌نام" };

const errors: Record<string, string> = {
  username: "از ۳ تا ۳۲ نویسه استفاده کنید: حروف انگلیسی، عدد و زیرخط.",
  reserved: "این نام کاربری رزرو شده است.",
  password: "رمز عبور باید بین ۴ تا ۷۲ نویسه باشد.",
  taken: "این نام کاربری قبلاً ثبت شده است.",
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
      <p className="text-sm font-medium text-accent">رأی‌دهندگان</p>
      <h1 className="mt-2 font-display text-5xl">ساخت حساب</h1>
      <p className="mt-3 text-muted">فقط نام کاربری و رمز عبور لازم است.</p>
      <form action={registerAction} className="mt-8 grid gap-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="نام کاربری" hint="حروف انگلیسی، عدد و زیرخط. ۳ تا ۳۲ نویسه.">
          <input name="username" dir="ltr" autoComplete="username" required minLength={3} maxLength={32} className={fieldClass} />
        </Field>
        <Field label="رمز عبور" hint="دست‌کم ۴ نویسه.">
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
        <button className={buttonClass()}>ساخت حساب</button>
      </form>
      <p className="mt-6 text-sm text-muted">
        قبلاً ثبت‌نام کرده‌اید؟{" "}
        <Link href="/login" className="font-semibold text-ink underline decoration-line underline-offset-4">
          وارد شوید
        </Link>
      </p>
    </main>
  );
}
