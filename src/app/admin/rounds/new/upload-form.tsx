"use client";

import { useMemo, useRef, useState } from "react";
import { guessColumn, mapRows, readCsv } from "@/lib/csv";
import { formatPrice } from "@/lib/format";
import { Alert, Badge, Field, buttonClass, fieldClass } from "@/components/ui";
import { createRoundAction } from "@/lib/actions/rounds";

export function UploadForm({ error }: { error?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [readError, setReadError] = useState("");
  const [domainColumn, setDomainColumn] = useState("");
  const [priceColumn, setPriceColumn] = useState("");
  const [premiumColumn, setPremiumColumn] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dragging, setDragging] = useState(false);

  async function loadFile(file: File) {
    setFileName(file.name);
    const text = await file.text();
    const read = readCsv(text);
    if (read.error) {
      setHeaders([]);
      setRecords([]);
      setReadError(read.error);
      return;
    }
    setReadError("");
    setHeaders(read.headers);
    setRecords(read.records);
    setDomainColumn(guessColumn(read.headers, [/domain/i, /name/i, /url/i, /دامنه/]));
    setPriceColumn(guessColumn(read.headers, [/price/i, /cost/i, /amount/i, /قیمت/]));
    setPremiumColumn(guessColumn(read.headers, [/premium/i, /پریمیوم/]));
    setFrom("");
    setTo("");
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    const input = inputRef.current;
    if (!file || !input) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    void loadFile(file);
  }

  const mapped = useMemo(() => {
    if (!domainColumn || records.length === 0) return null;
    return mapRows(records, headers, {
      domainColumn,
      priceColumn: priceColumn || undefined,
      premiumColumn: premiumColumn || undefined,
    }, {
      from: from.trim() ? Number(from) : null,
      to: to.trim() ? Number(to) : null,
    });
  }, [domainColumn, from, headers, premiumColumn, priceColumn, records, to]);

  const preview = mapped?.rows.slice(0, 5) ?? [];

  return (
    <form action={createRoundAction} className="mt-8 grid gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="عنوان دور" hint="رأی‌دهندگان این نام را در فهرست دورها می‌بینند.">
        <input name="title" required maxLength={80} className={fieldClass} placeholder="فهرست اسفند" />
      </Field>

      <div className="grid gap-2">
        <span className="text-sm font-medium">فایل CSV</span>
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`grid cursor-pointer gap-1 rounded-xl border border-dashed px-5 py-8 text-center transition ${
            dragging ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-ink/30"
          }`}
        >
          <span className="font-semibold">{fileName || "فایل CSV را اینجا رها کنید، یا انتخاب کنید"}</span>
          <span className="text-sm text-muted">ردیف اول باید نام ستون‌ها باشد. حداکثر ۲۰ مگابایت.</span>
          <input
            ref={inputRef}
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
            }}
          />
        </label>
        {readError ? <p className="text-sm text-danger">{readError}</p> : null}
      </div>

      {headers.length > 0 ? (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="ستون دامنه">
              <select
                name="domainColumn"
                required
                value={domainColumn}
                onChange={(event) => setDomainColumn(event.target.value)}
                className={fieldClass}
              >
                <option value="">یک ستون انتخاب کنید…</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ستون قیمت" hint="اختیاری.">
              <select
                name="priceColumn"
                value={priceColumn}
                onChange={(event) => setPriceColumn(event.target.value)}
                className={fieldClass}
              >
                <option value="">نگاشت نشده</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ستون پریمیوم" hint="بله، true، 1، y یا premium.">
              <select
                name="premiumColumn"
                value={premiumColumn}
                onChange={(event) => setPremiumColumn(event.target.value)}
                className={fieldClass}
              >
                <option value="">نگاشت نشده</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="ردیف شروع" hint="اختیاری. ردیف ۱ اولین ردیف داده، زیر سرستون است.">
              <input
                name="from"
                type="number"
                min={1}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={fieldClass}
              />
            </Field>
            <Field label="ردیف پایان" hint={`اختیاری. این فایل ${records.length} ردیف داده دارد.`}>
              <input
                name="to"
                type="number"
                min={1}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className={fieldClass}
              />
            </Field>
          </div>

          {mapped?.error ? <Alert tone="danger">{mapped.error}</Alert> : null}
          {mapped && !mapped.error ? (
            <Alert tone="success">
              {mapped.rows.length} دامنه وارد می‌شود.
              {mapped.skippedEmpty || mapped.skippedDuplicate
                ? ` ${mapped.skippedEmpty} ردیف خالی و ${mapped.skippedDuplicate} تکراری رد می‌شود.`
                : ""}
            </Alert>
          ) : null}

          {preview.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[32rem] border-collapse text-start text-sm">
                <caption className="border-b border-line px-4 py-3 text-start text-muted">
                  {preview.length} دامنهٔ اول پس از نگاشت
                </caption>
                <thead className="bg-card text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">دامنه</th>
                    <th className="px-4 py-3 font-medium">قیمت</th>
                    <th className="px-4 py-3 font-medium">پریمیوم</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.name} className="border-t border-line">
                      <td dir="ltr" className="px-4 py-3 font-mono">{row.name}</td>
                      <td dir="ltr" className="px-4 py-3 tabular-nums">{formatPrice(row.price)}</td>
                      <td className="px-4 py-3">
                        {row.isPremium ? <Badge tone="gold">پریمیوم</Badge> : <span className="text-muted">معمولی</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      <div>
        <button className={buttonClass()} disabled={Boolean(readError || mapped?.error)}>
          باز کردن دور رأی‌گیری
        </button>
      </div>
    </form>
  );
}
