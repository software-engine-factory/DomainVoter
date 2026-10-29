// Targeted negative controls for CASES.md, following the test-red-team skill.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { startServer } from './server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const { server, origin } = await startServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PERF_CHROMIUM ? { executablePath: process.env.PERF_CHROMIUM } : {}) });
const observations = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const stats = async () => (await (await fetch(`${origin}/api/stats`)).json()).requests;
async function fresh(variant) {
  await fetch(`${origin}/api/reset`, { method: 'POST' });
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/?variant=${variant}`);
  await page.locator('form').waitFor();
  if (variant.startsWith('f')) await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.getAttribute('data-state') === 'ready');
  return { context, page };
}
function record(name, data) { observations.push({ name, ...data }); console.log(name, JSON.stringify(data)); }
try {
  for (const mutant of ['', '&mutant=stale']) {
    const { context, page } = await fresh(`f1${mutant}`);
    await page.locator('input[name=minUsd]').fill('1'); await delay(300);
    await page.evaluate(() => {
      window.obsoleteDisplayed = false;
      const node = document.querySelector('[data-testid=count]');
      new MutationObserver(() => { if (node.textContent.includes('111')) window.obsoleteDisplayed = true; }).observe(node, { childList: true, subtree: true, characterData: true });
    });
    await page.locator('input[name=minUsd]').fill('2');
    await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.textContent?.includes('222'));
    const count = await page.locator('[data-testid=count]').textContent();
    const obsoleteDisplayed = await page.evaluate(() => window.obsoleteDisplayed);
    let verdict = 'GREEN';
    try { assert.equal(count, '222 names'); assert.equal(obsoleteDisplayed, false); } catch { verdict = 'RED'; }
    assert.equal(verdict, mutant ? 'RED' : 'GREEN');
    record(`latest-response-${mutant ? 'mutated' : 'normal'}`, { verdict, count, obsoleteDisplayed, mutation: mutant ? 'Accept every response instead of checking generation' : null });
    await context.close();
  }
  for (const variant of ['f1', 'f2']) {
    const { context, page } = await fresh(variant);
    const before = (await stats()).filter(r => r.path === '/api/count').length;
    await page.locator('input[name=minUsd]').fill('1'); await delay(300);
    await page.locator('input[name=minUsd]').fill('2'); await delay(300);
    await page.locator('input[name=minUsd]').fill('3');
    await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.textContent === '333 names');
    const requests = (await stats()).filter(r => r.path === '/api/count').slice(before);
    const { countPeakActive } = await (await fetch(`${origin}/api/stats`)).json();
    assert.deepEqual(requests.map(r => r.body.minUsd), ['1', '3']);
    assert.equal(countPeakActive, 1);
    await page.route('**/api/jobs/*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'held', state: 'running', phase: 'selecting', processed: 0, total: 0, updatedAt: Date.now() }) }));
    if (variant === 'f2') {
      await page.getByRole('button', { name: 'Create first', exact: true }).click();
      await page.waitForSelector('h3');
      await page.waitForFunction(() => document.querySelector('[data-testid=progress]')?.textContent?.includes('total unknown'));
      assert.equal(await page.locator('progress').getAttribute('value'), null);
    } else {
      await page.getByRole('button', { name: 'Create first', exact: true }).click();
      await page.waitForSelector('a[href="/result?kind=sync"]');
    }
    const create = (await stats()).find(r => r.path === (variant === 'f1' ? '/api/create' : '/api/jobs'));
    assert.equal(create.body.createMode, 'first');
    record(`${variant}-coalesce-submitter`, { countRequests: requests.length, filterValues: ['1', '3'], peakActive: countPeakActive, createMode: create.body.createMode, ...(variant === 'f2' ? { unknownTotalIndeterminate: true } : {}) });
    await context.close();
  }
  for (const mutant of ['', '&mutant=duplicate']) {
    const { context, page } = await fresh(`f1${mutant}`);
    await page.evaluate(() => { const form = document.querySelector('form'); form.requestSubmit(); form.requestSubmit(); });
    await delay(100);
    const creates = (await stats()).filter(r => r.path === '/api/create').length;
    let verdict = 'GREEN';
    try { assert.equal(creates, 1); } catch { verdict = 'RED'; }
    assert.equal(verdict, mutant ? 'RED' : 'GREEN');
    record(`submission-${mutant ? 'mutated' : 'normal'}`, { verdict, requests: creates, mutation: mutant ? 'Bypass synchronous busy ref guard' : null });
    await delay(1800); await context.close();
  }
  for (const variant of ['pool', 'batch']) {
    const { context, page } = await fresh(variant);
    if (variant === 'pool') await page.locator('ol button').nth(2).click();
    await page.locator('input[name=title]').fill('Duplicate experiment');
    await delay(450);
    await page.evaluate(() => { const form = document.querySelector('form'); form.requestSubmit(); form.requestSubmit(); });
    await delay(3900);
    const requests = (await stats()).filter(r => r.path === '/api/create').length;
    assert.equal(requests, 2);
    record(`baseline-${variant}-duplicate`, { requests, note: 'Unchanged React form, serial fixture dispatcher. Real Next navigation and transport not measured.' });
    await context.close();
  }
  {
    const { context, page } = await fresh('f2');
    await page.locator('input[name=title]').fill('lostjob');
    await page.getByRole('button', { name: 'Create all', exact: true }).click();
    await page.getByRole('button', { name: 'Recover ticket' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Recover ticket' }).click();
    await page.waitForSelector('h3');
    const calls = (await stats()).filter(r => r.path === '/api/jobs');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.key, calls[1].body.key);
    assert.deepEqual(calls[0].body, calls[1].body);
    assert.equal(await page.locator('h3').textContent(), 'Ticket fixture-1');
    record('f2-lost-ack', { postRequests: calls.length, distinctKeys: new Set(calls.map(r => r.body.key)).size, ticket: 'fixture-1', recoveredAfterReload: true, note: 'Stub idempotency only. No production guarantee.' });
    await context.close();
  }
  await writeFile('tools/perf/frontend/results/audit.json', JSON.stringify({ measuredAt: new Date().toISOString(), browser: browser.version(), observations }, null, 2) + '\n');
  console.log('PASS: mutation checks red/green, baseline duplicates, and lost acknowledgement recovery.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
