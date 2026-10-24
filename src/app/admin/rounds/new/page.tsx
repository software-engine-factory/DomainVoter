import type { Metadata } from "next";
import { one } from "@/lib/format";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "ساخت دور" };

const errors: Record<string, string> = {
  title: "برای دور عنوانی تا ۸۰ نویسه بگذارید.",
  file: "یک فایل CSV انتخاب کنید.",
  size: "این فایل بزرگ‌تر از ۲۰ مگابایت است.",
};

export default async function NewRoundPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const code = one(query.error);
  const error = code === "parse" ? one(query.message) || "این فایل خوانده نشد." : errors[code ?? ""];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl">ساخت دور رأی‌گیری</h1>
      <p className="mt-3 max-w-xl text-muted">
        یک فایل بارگذاری کنید، ستون دامنه، قیمت و پریمیوم را مشخص کنید و دور را باز کنید. نام‌های خالی رد می‌شوند.
        اگر دامنه‌ای تکرار شده باشد، ردیف اول نگه داشته می‌شود.
      </p>
      <UploadForm error={error} />
    </main>
  );
}
