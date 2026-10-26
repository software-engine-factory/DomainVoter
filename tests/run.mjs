// Node test runner over the real TS modules: node tests/run.mjs  (uses a throwaway DATA_DIR)
import fs from "fs";
import os from "os";
import path from "path";
import { createJiti } from "jiti";

const root = path.resolve(import.meta.dirname, "..");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dv-test-"));
globalThis.__dvJiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") }, interopDefault: true });

const files = fs.readdirSync(import.meta.dirname).filter((f) => f.endsWith(".test.mjs")).sort();
for (const f of files) await import(path.join(import.meta.dirname, f));
