import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { getSqlite } from "@/db";

/** Columns of app_export_purchasable.{csv,db}. Anything else in the file is ignored. */
export const POOL_COLUMNS = [
  "name",
  "set_1",
  "set_2",
  "set_3",
  "set_4",
  "set_5",
  "evidence",
  "dns_ns_class",
  "dns_parking_provider",
  "lp_marketplace",
  "lp_price",
  "lp_currency",
  "lp_url",
  "best_price",
  "best_source",
] as const;

export type ImportResult = {
  importId: number;
  rowsRead: number;
  rowsUpserted: number;
  rowsSkipped: number;
  error?: string;
};

type Raw = Record<string, unknown>;

const BATCH = 5000;

function text(value: unknown) {
  if (value == null) return null;
  const out = String(value).trim();
  return out ? out : null;
}

function flag(value: unknown) {
  const out = String(value ?? "").trim().toLowerCase();
  return out === "1" || out === "true" || out === "yes" ? 1 : 0;
}

function num(value: unknown) {
  const out = text(value);
  if (out == null) return null;
  const parsed = Number(out.replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeName(value: unknown) {
  const out = text(value)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!out) return null;
  return out.includes(".") ? out : `${out}.com`;
}

/** Turns a raw row into bind parameters, or null when the row has no usable name. */
/** set_1..set_5 may arrive with a label suffix (set_1_loose, set_2_persian, …); read either form. */
function setFlag(row: Raw, n: number) {
  const exact = row[`set_${n}`];
  if (exact !== undefined) return flag(exact);
  const key = Object.keys(row).find((k) => k.toLowerCase().startsWith(`set_${n}_`));
  return flag(key ? row[key] : undefined);
}

export function normalizeRow(row: Raw, now: number) {
  const name = normalizeName(row.name);
  if (!name) return null;
  const evidence = text(row.evidence)?.toLowerCase() ?? null;
  const currency = text(row.lp_currency)?.toUpperCase() ?? null;
  const lpPrice = num(row.lp_price);
  const bestPrice = num(row.best_price);
  const lpUrl = text(row.lp_url);
  return {
    name,
    set_1: setFlag(row, 1),
    set_2: setFlag(row, 2),
    set_3: setFlag(row, 3),
    set_4: setFlag(row, 4),
    set_5: setFlag(row, 5),
    evidence: evidence === "sale_page" || evidence === "nameserver" ? evidence : null,
    dns_ns_class: text(row.dns_ns_class)?.toLowerCase() ?? null,
    dns_parking_provider: text(row.dns_parking_provider)?.toLowerCase() ?? null,
    lp_marketplace: text(row.lp_marketplace),
    lp_price: lpPrice,
    lp_currency: currency,
    lp_url: lpUrl && /^https?:\/\//i.test(lpUrl) ? lpUrl : null,
    best_price: bestPrice,
    best_source: text(row.best_source),
    // Price sort and price bands are USD-only; other currencies keep their price but never get converted.
    price_usd: currency === "USD" ? (lpPrice ?? bestPrice) : null,
    imported_at: now,
  };
}

function upsertStatement() {
  return getSqlite().prepare(`
    INSERT INTO pool (name, set_1, set_2, set_3, set_4, set_5, evidence, dns_ns_class, dns_parking_provider,
                      lp_marketplace, lp_price, lp_currency, lp_url, best_price, best_source, price_usd, imported_at)
    VALUES (@name, @set_1, @set_2, @set_3, @set_4, @set_5, @evidence, @dns_ns_class, @dns_parking_provider,
            @lp_marketplace, @lp_price, @lp_currency, @lp_url, @best_price, @best_source, @price_usd, @imported_at)
    ON CONFLICT(name) DO UPDATE SET
      set_1 = excluded.set_1, set_2 = excluded.set_2, set_3 = excluded.set_3,
      set_4 = excluded.set_4, set_5 = excluded.set_5, evidence = excluded.evidence,
      dns_ns_class = excluded.dns_ns_class, dns_parking_provider = excluded.dns_parking_provider,
      lp_marketplace = excluded.lp_marketplace, lp_price = excluded.lp_price, lp_currency = excluded.lp_currency,
      lp_url = excluded.lp_url, best_price = excluded.best_price, best_source = excluded.best_source,
      price_usd = excluded.price_usd, imported_at = excluded.imported_at`);
}

function startImport(source: string) {
  const info = getSqlite()
    .prepare("INSERT INTO imports (source, started_at) VALUES (?, ?)")
    .run(source, Date.now());
  return Number(info.lastInsertRowid);
}

function finishImport(result: ImportResult) {
  getSqlite()
    .prepare(
      "UPDATE imports SET finished_at = ?, rows_read = ?, rows_upserted = ?, rows_skipped = ?, error = ? WHERE id = ?",
    )
    .run(Date.now(), result.rowsRead, result.rowsUpserted, result.rowsSkipped, result.error ?? null, result.importId);
  return result;
}

/** Batches rows into one transaction per BATCH rows so 125k rows never sit in memory at once. */
function makeWriter(now: number) {
  const sqlite = getSqlite();
  const upsert = upsertStatement();
  const flush = sqlite.transaction((rows: ReturnType<typeof normalizeRow>[]) => {
    for (const row of rows) if (row) upsert.run(row);
  });
  let buffer: NonNullable<ReturnType<typeof normalizeRow>>[] = [];
  const stats = { read: 0, upserted: 0, skipped: 0 };
  return {
    stats,
    push(raw: Raw) {
      stats.read += 1;
      const row = normalizeRow(raw, now);
      if (!row) {
        stats.skipped += 1;
        return;
      }
      buffer.push(row);
      if (buffer.length >= BATCH) this.flush();
    },
    flush() {
      if (buffer.length === 0) return;
      flush(buffer);
      stats.upserted += buffer.length;
      buffer = [];
    },
  };
}

export function importCsvStream(stream: NodeJS.ReadableStream, source: string): Promise<ImportResult> {
  const importId = startImport(source);
  const writer = makeWriter(Date.now());
  let headerError: string | undefined;
  return new Promise((resolve) => {
    Papa.parse<Raw>(stream as unknown as File, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim().toLowerCase(),
      step(result, parser) {
        if (writer.stats.read === 0 && !result.meta.fields?.includes("name")) {
          headerError = "ستون name در فایل نیست.";
          parser.abort();
          return;
        }
        writer.push(result.data);
      },
      complete() {
        try {
          writer.flush();
        } catch (error) {
          headerError = String(error);
        }
        resolve(
          finishImport({
            importId,
            rowsRead: writer.stats.read,
            rowsUpserted: writer.stats.upserted,
            rowsSkipped: writer.stats.skipped,
            error: headerError,
          }),
        );
      },
      error(error) {
        resolve(
          finishImport({ importId, rowsRead: writer.stats.read, rowsUpserted: writer.stats.upserted, rowsSkipped: writer.stats.skipped, error: error.message }),
        );
      },
    });
  });
}

/** Reads the export SQLite read-only and streams its rows through the same upsert. */
export function importSqliteFile(file: string, source: string): ImportResult {
  const importId = startImport(source);
  const sqlite = getSqlite();
  const writer = makeWriter(Date.now());
  try {
    // Plain path: better-sqlite3 is built without URI filenames, so ?mode=ro would not open. Only SELECTs run on src.
    sqlite.prepare("ATTACH DATABASE ? AS src").run(file);
    try {
      const tables = sqlite
        .prepare("SELECT name FROM src.sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      const preferred = process.env.FORSALE_IMPORT_TABLE;
      const table =
        tables.find((t) => t.name === preferred) ??
        tables.find((t) => t.name === "app_names") ??
        tables.find((t) => t.name === "app_export_purchasable") ??
        tables.find((t) => t.name === "names") ??
        (tables.length === 1 ? tables[0] : undefined);
      if (!table) throw new Error(`جدول خروجی پیدا نشد (${tables.map((t) => t.name).join(", ") || "خالی"}).`);
      const present = (sqlite.prepare(`PRAGMA src.table_info("${table.name.replaceAll('"', '""')}")`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      );
      const find = (c: string) =>
        present.find((p) => p.toLowerCase() === c) ??
        (/^set_\d$/.test(c) ? present.find((p) => p.toLowerCase().startsWith(`${c}_`)) : undefined);
      if (!find("name")) throw new Error("ستون name در جدول نیست.");
      const columns = POOL_COLUMNS.flatMap((c) => {
        const col = find(c);
        return col ? [`"${col.replaceAll('"', '""')}" AS "${c}"`] : [];
      });
      // Read in rowid pages: the same connection writes the upserts, and SQLite won't write while a SELECT is open.
      const quoted = table.name.replaceAll('"', '""');
      const page = sqlite.prepare(`SELECT rowid AS __rid, ${columns.join(", ")} FROM src."${quoted}" WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH}`);
      let last = 0;
      for (;;) {
        const rows = page.all(last) as Array<Raw & { __rid: number }>;
        if (!rows.length) break;
        for (const row of rows) writer.push(row);
        last = rows[rows.length - 1].__rid;
      }
      writer.flush();
    } finally {
      sqlite.exec("DETACH DATABASE src");
    }
    return finishImport({ importId, rowsRead: writer.stats.read, rowsUpserted: writer.stats.upserted, rowsSkipped: writer.stats.skipped });
  } catch (error) {
    return finishImport({
      importId,
      rowsRead: writer.stats.read,
      rowsUpserted: writer.stats.upserted,
      rowsSkipped: writer.stats.skipped,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function importFile(file: string, source = file): Promise<ImportResult> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".db" || ext === ".sqlite" || ext === ".sqlite3") return importSqliteFile(file, source);
  return importCsvStream(fs.createReadStream(file, { encoding: "utf8" }), source);
}
