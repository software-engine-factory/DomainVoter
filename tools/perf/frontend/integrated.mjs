// Optional one-job correctness sample against the worker agent's synthetic SQLite adapter.
// Requires PERF_JOB_ADAPTER. Never uses the replica or production database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { startServer } from './server.mjs';
if (!process.env.PERF_JOB_ADAPTER) throw new Error('PERF_JOB_ADAPTER must point to the synthetic worker adapter');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const { server, origin } = await startServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PERF_CHROMIUM ? { executablePath: process.env.PERF_CHROMIUM } : {}) });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const snapshots = [];
  let submittedAt;
  page.on('response', async response => {
    if (/\/api\/jobs\/[^/]+$/.test(new URL(response.url()).pathname)) {
      const snapshot = await response.json();
      snapshots.push({ afterSubmitMs: Date.now() - submittedAt, state: snapshot.state, phase: snapshot.phase, processed: snapshot.processed, total: snapshot.total });
    }
  });
  await page.goto(`${origin}/?variant=f2`);
  await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.getAttribute('data-state') === 'ready');
  submittedAt = Date.now();
  const feedbackMs = await page.evaluate(() => new Promise(resolve => {
    const start = performance.now(), target = document.querySelector('[data-testid=creation]');
    const observer = new MutationObserver(() => { if (target.textContent.includes('Submitting')) { observer.disconnect(); requestAnimationFrame(() => resolve(performance.now() - start)); } });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    document.querySelector('form').requestSubmit();
  }));
  await page.waitForSelector('h3');
  const acceptedMs = Date.now() - submittedAt;
  const ticket = (await page.locator('h3').textContent()).replace('Ticket ', '');
  await page.reload(); await page.waitForSelector('h3');
  assert.equal((await page.locator('h3').textContent()).replace('Ticket ', ''), ticket);
  await page.waitForFunction(() => document.querySelector('[data-testid=job-state]')?.textContent === 'completed');
  const completedVisibleMs = Date.now() - submittedAt;
  const progress = await page.locator('[data-testid=progress]').textContent();
  assert.ok(progress.includes('10,000 / 10,000'));
  const result = await (await fetch(`${origin}/results/${ticket}`)).json();
  assert.deepEqual(result, { count: 10000, uniqueNames: 10000, firstPosition: 1, lastPosition: 10000 });
  const stats = await (await fetch(`${origin}/api/stats`)).json();
  const creates = stats.requests.filter(r => r.path === '/api/jobs').length;
  assert.equal(creates, 1);
  const firstProgress = snapshots.find(s => s.processed > 0);
  const output = { measuredAt: new Date().toISOString(), browser: browser.version(), source: 'Synthetic 4L 10000-row SQLite fixture, real durable job queue and writer thread, not source replica', feedbackMs, acceptedVisibleMs: acceptedMs, firstNonzeroStatusMs: firstProgress?.afterSubmitMs ?? null, completedVisibleMs, creationRequests: creates, reattachedAfterReload: true, snapshots, result, note: 'One small correctness sample. Does not establish production throughput, idempotency, or crash recovery.' };
  await writeFile('tools/perf/frontend/results/integrated.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
  await context.close();
} finally { await browser.close(); await new Promise(r => server.close(r)); }
