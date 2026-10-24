import Papa from "papaparse";

export type MappedDomain = {
  name: string;
  price: number | null;
  isPremium: boolean;
};

export type CsvMapping = {
  domainColumn: string;
  priceColumn?: string;
  premiumColumn?: string;
};

export type CsvRange = {
  from?: number | null;
  to?: number | null;
};

export type MappedCsv = {
  rows: MappedDomain[];
  dataRowCount: number;
  skippedEmpty: number;
  skippedDuplicate: number;
  error?: string;
};

const PREMIUM_VALUES = new Set(["1", "true", "yes", "y", "premium", "بله", "پریمیوم"]);

export function parsePrice(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parsePremium(raw: string | undefined | null): boolean {
  if (raw == null) return false;
  return PREMIUM_VALUES.has(String(raw).trim().toLowerCase());
}

export function guessColumn(headers: string[], patterns: RegExp[]) {
  return headers.find((header) => patterns.some((pattern) => pattern.test(header))) ?? "";
}

export function readCsv(text: string): {
  headers: string[];
  records: Record<string, string>[];
  error?: string;
} {
  if (!text.trim()) {
    return { headers: [], records: [], error: "این فایل خالی است." };
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const headers = (parsed.meta.fields ?? []).map((header) => header.trim()).filter(Boolean);
  if (headers.length === 0) {
    return { headers: [], records: [], error: "ردیف سرستون پیدا نشد. ردیف اول باید نام ستون‌ها باشد." };
  }
  if (parsed.data.length === 0) {
    return { headers, records: [], error: "این فایل ردیف داده ندارد." };
  }
  return { headers, records: parsed.data };
}

export function mapRows(
  records: Record<string, string>[],
  headers: string[],
  mapping: CsvMapping,
  range?: CsvRange,
): MappedCsv {
  const dataRowCount = records.length;
  if (!mapping.domainColumn) {
    return { rows: [], dataRowCount, skippedEmpty: 0, skippedDuplicate: 0, error: "ستون دامنه را انتخاب کنید." };
  }
  if (!headers.includes(mapping.domainColumn)) {
    return {
      rows: [],
      dataRowCount,
      skippedEmpty: 0,
      skippedDuplicate: 0,
      error: "یک ستون دامنه از فایل انتخاب کنید.",
    };
  }

  let from = range?.from ?? 1;
  let to = range?.to ?? dataRowCount;
  if (from == null || !Number.isFinite(from)) from = 1;
  if (to == null || !Number.isFinite(to)) to = dataRowCount;
  from = Math.floor(from);
  to = Math.floor(to);

  if (from < 1) {
    return { rows: [], dataRowCount, skippedEmpty: 0, skippedDuplicate: 0, error: "ردیف شروع باید دست‌کم ۱ باشد." };
  }
  if (from > dataRowCount) {
    return {
      rows: [],
      dataRowCount,
      skippedEmpty: 0,
      skippedDuplicate: 0,
      error: "ردیف شروع بعد از پایان فایل است.",
    };
  }
  if (to < from) {
    return {
      rows: [],
      dataRowCount,
      skippedEmpty: 0,
      skippedDuplicate: 0,
      error: "ردیف پایان باید همان ردیف شروع یا بعد از آن باشد.",
    };
  }
  to = Math.min(to, dataRowCount);

  const seen = new Set<string>();
  const rows: MappedDomain[] = [];
  let skippedEmpty = 0;
  let skippedDuplicate = 0;

  for (const record of records.slice(from - 1, to)) {
    const name = (record[mapping.domainColumn] ?? "").trim().toLowerCase();
    if (!name) {
      skippedEmpty += 1;
      continue;
    }
    if (seen.has(name)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(name);
    rows.push({
      name,
      price: mapping.priceColumn ? parsePrice(record[mapping.priceColumn]) : null,
      isPremium: mapping.premiumColumn ? parsePremium(record[mapping.premiumColumn]) : false,
    });
  }

  if (rows.length === 0) {
    return {
      rows,
      dataRowCount,
      skippedEmpty,
      skippedDuplicate,
      error: "بعد از پاک‌سازی این فایل دامنه‌ای نماند.",
    };
  }

  return { rows, dataRowCount, skippedEmpty, skippedDuplicate };
}

export function parseDomainCsv(text: string, mapping: CsvMapping, range?: CsvRange) {
  const read = readCsv(text);
  if (read.error) {
    return {
      rows: [],
      dataRowCount: read.records.length,
      skippedEmpty: 0,
      skippedDuplicate: 0,
      error: read.error,
    } satisfies MappedCsv;
  }
  return mapRows(read.records, read.headers, mapping, range);
}
