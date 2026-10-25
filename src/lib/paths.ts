import path from "path";

/** Folder that holds SQLite, the session secret, and import files. Mounted at /app/data in Coolify. */
export function dataDir() {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
}

/**
 * Default file for "import/sync now". Relative paths resolve inside the data folder.
 * Override with FORSALE_IMPORT_PATH; the admin can also type a path per import.
 */
export function defaultImportPath() {
  return process.env.FORSALE_IMPORT_PATH || "forsale/app_export_purchasable.csv";
}

/** Resolve an admin-supplied path, refusing anything outside the data folder. */
export function resolveImportPath(input: string) {
  const root = dataDir();
  const resolved = path.resolve(root, input.trim());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
