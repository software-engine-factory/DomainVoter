// Research launcher for the unchanged application suite.
// tests/run.mjs passes Windows drive paths to import(), which Node rejects.
// This preserves its setup and cases, converting only module paths to file URLs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '../..');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-perf-tests-'));
process.env.DV_FREE_MOVE = 'off';
globalThis.__dvJiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
  interopDefault: true,
});
const directory = path.join(root, 'tests');
const files = fs.readdirSync(directory).filter(file => file.endsWith('.test.mjs')).sort();
if (!files.length) throw new Error('No existing test cases found');
for (const file of files) await import(pathToFileURL(path.join(directory, file)).href);
