// Research launcher for the unchanged application suite.
// tests/run.mjs passes Windows drive paths to import(), which Node rejects.
// This preserves its setup and cases, converting only module paths to file URLs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
if (process.env.DV_PERF_TEST_CHILD !== '1') {
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-perf-tests-'));
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, DATA_DIR: testDirectory, DV_PERF_TEST_CHILD: '1' },
  });
  // Windows releases SQLite/reader handles when the child exits.
  fs.rmSync(testDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
process.env.DV_FREE_MOVE = 'off';
globalThis.__dvJiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
  interopDefault: true,
});
const directory = path.join(root, 'tests');
const files = fs.readdirSync(directory).filter(file => file.endsWith('.test.mjs')).sort();
if (!files.length) throw new Error('No existing test cases found');
for (const file of files) await import(pathToFileURL(path.join(directory, file)).href);
