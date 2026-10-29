import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { startServer } from './server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const { server, origin } = await startServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PERF_CHROMIUM ? { executablePath: process.env.PERF_CHROMIUM } : {}) });
const results = { measuredAt: new Date().toISOString(), sourceCommit: '0506c5e', browser: browser.version(), note: 'Actual React DOM; unchanged baseline form components; stub actions/HTTP only; no database', cases: [] };
const record = (name, data) => { results.cases.push({ name, ...data }); console.log(name, JSON.stringify(data)); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const stats = async path => (await (await fetch(`${origin}/api/stats`)).json()).requests.filter(r => r.path === path);
async function fresh(variant) {
  await fetch(`${origin}/api/reset`, { method: 'POST' });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/?variant=${variant}`);
  await page.locator('form').waitFor();
  if (variant.startsWith('f')) await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.getAttribute('data-state') === 'ready');
  if (variant === 'batch') { await page.waitForFunction(() => !document.querySelector('aside')?.textContent?.includes('…')); }
  return { context, page };
}
try {
  // These are negative controls. Their failures are recorded, never counted as passing product behavior.
  for (const variant of ['pool', 'batch']) {
    const { context, page } = await fresh(variant);
    if (variant === 'pool') await page.locator('ol button').nth(2).click();
    const before = (await stats('/api/count')).length;
    await page.locator('input[name=title]').fill('Changed title only');
    await wait(450); // Observation window > the source's 250ms debounce + fixture's 120ms count.
    const titleCounts = (await stats('/api/count')).length - before;
    const pending = await page.evaluate(async () => {
      const form = document.querySelector('form');
      form.requestSubmit();
      await new Promise(r => setTimeout(r, 80));
      return { busy: form.getAttribute('aria-busy'), submitDisabled: [...form.querySelectorAll('button:not([type=button])')].every(b => b.disabled) };
    });
    assert.equal(titleCounts, 1, 'negative control should expose metadata recount');
    assert.equal(pending.submitDisabled, false, 'negative control should expose active submit');
    record(`baseline-${variant}`, { titleOnlyCountRequests: titleCounts, pendingAfter80ms: pending, expectedRequirementFailure: true });
    await wait(1900); await context.close();
  }
  // The serial action model shows an obsolete intermediate value, even though final result order is preserved.
  {
    const { context, page } = await fresh('batch');
    await page.locator('input[name=minUsd]').fill('1');
    await wait(300);
    await page.locator('input[name=minUsd]').fill('2');
    await page.evaluate(() => {
      window.obsoleteSeen = false;
      const aside = document.querySelector('aside');
      new MutationObserver(() => { if (aside.textContent.includes('111')) window.obsoleteSeen = true; }).observe(aside, { childList: true, subtree: true, characterData: true });
    });
    await wait(1250);
    record('baseline-serial-stale', { obsoleteCountCommitted: await page.evaluate(() => window.obsoleteSeen), countRequests: (await stats('/api/count')).length, note: 'Batch masks count with ellipsis while counting; stale state commit may remain visually hidden.' });
    await context.close();
  }
  for (const variant of ['f1', 'f2']) {
    for (let sample = 1; sample <= 3; sample++) {
      const { context, page } = await fresh(variant);
      const before = (await stats('/api/count')).length;
      for (let i = 0; i < 5; i++) await page.locator('input[name=title]').fill(`Title ${i}`);
      await page.locator('select[name=order]').selectOption('name');
      await page.locator('input[name=rounds]').fill('6');
      await page.locator('input[name=perRound]').fill('600');
      await wait(400);
      assert.equal((await stats('/api/count')).length - before, 0);
      for (const value of ['3', '4', '5', '6', '2']) { await page.locator('input[name=minUsd]').fill(value); await wait(50); }
      await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.getAttribute('data-state') === 'ready');
      const rapid = (await stats('/api/count')).length - before;
      assert.equal(rapid, 1);
      // Time from submit event to first animation frame after pending text commits.
      const feedbackMs = await page.evaluate(() => new Promise(resolve => {
        const start = performance.now(), form = document.querySelector('form'), target = document.querySelector('[data-testid=creation]');
        window.submitStart = start;
        const observer = new MutationObserver(() => {
          if (target.textContent.includes('Creating') || target.textContent.includes('Submitting')) {
            observer.disconnect(); requestAnimationFrame(() => resolve(performance.now() - start));
          }
        });
        observer.observe(target, { childList: true, characterData: true, subtree: true });
        form.requestSubmit(); form.requestSubmit();
      }));
      assert.ok(feedbackMs < 100, `feedback budget exceeded: ${feedbackMs}`);
      if (variant === 'f1') await page.waitForSelector('a[href="/result?kind=sync"]');
      else await page.waitForSelector('h3');
      const creates = await stats(variant === 'f1' ? '/api/create' : '/api/jobs');
      assert.equal(creates.length, 1);
      const responseFeedbackMs = await page.evaluate(() => performance.now() - window.submitStart);
      if (variant === 'f2') {
        const ticket = await page.locator('h3').textContent();
        await page.reload(); await page.waitForSelector('h3');
        assert.equal(await page.locator('h3').textContent(), ticket);
        assert.equal((await stats('/api/jobs')).length, 1);
        const freshness = await page.evaluate(() => new Promise(resolve => {
          let maximum = 0;
          const timer = setInterval(() => {
            const state = document.querySelector('[data-testid=job-state]')?.textContent;
            maximum = Math.max(maximum, Number(document.querySelector('[data-testid=age]')?.textContent?.match(/\d+/)?.[0] || 0));
            if (state === 'completed') { clearInterval(timer); resolve(maximum); }
          }, 50);
        }));
        await page.waitForSelector('a[href="/result?kind=job"]');
        const pollsBefore = (await stats(`/api/jobs/${ticket.replace('Ticket ', '')}`)).length;
        await wait(1100);
        assert.equal((await stats(`/api/jobs/${ticket.replace('Ticket ', '')}`)).length, pollsBefore, 'terminal job must stop polling');
        record(`${variant}-sample-${sample}`, { feedbackMs, ticketVisibleMs: responseFeedbackMs, metadataCountRequests: 0, rapidFilterCountRequests: rapid, creationRequests: creates.length, resumedWithoutResubmit: true, maximumObservedSnapshotAgeMs: freshness, statusRequestsIncludingResume: pollsBefore });
      } else record(`${variant}-sample-${sample}`, { feedbackMs, resultVisibleMs: responseFeedbackMs, metadataCountRequests: 0, rapidFilterCountRequests: rapid, creationRequests: creates.length });
      assert.equal(await page.locator('[data-testid=rows] li').count(), 50);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      assert.equal(await page.locator('[data-testid=rows] li').count(), 50);
      await context.close();
    }
    {
      const { context, page } = await fresh(variant);
      await page.locator('input[name=minUsd]').fill('1'); await wait(300);
      await page.locator('input[name=minUsd]').fill('2');
      await page.evaluate(() => {
        window.staleDisplayed = false;
        const node = document.querySelector('[data-testid=count]');
        new MutationObserver(() => { if (node.textContent.includes('111')) window.staleDisplayed = true; }).observe(node, { childList: true, subtree: true, characterData: true });
      });
      await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.textContent?.includes('222'));
      await wait(650); // Ensure the slower old response has also arrived.
      const stale = await page.evaluate(() => window.staleDisplayed);
      assert.equal(stale, false);
      record(`${variant}-obsolete-count`, { staleDisplayed: stale, finalCount: await page.locator('[data-testid=count]').textContent() });
      await page.locator('input[name=minUsd]').fill('999');
      await page.waitForSelector('button:has-text("Retry count")');
      const beforeRetry = (await stats('/api/count')).length;
      const retryResponse = page.waitForResponse(r => r.url().endsWith('/api/count'));
      await page.getByRole('button', { name: 'Retry count' }).click();
      await retryResponse;
      await page.waitForSelector('button:has-text("Retry count")');
      assert.equal((await stats('/api/count')).length, beforeRetry + 1);
      await page.locator('input[name=minUsd]').fill('2');
      await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.getAttribute('data-state') === 'ready');
      record(`${variant}-count-recovery`, { retryVisible: true, recovered: true });
      await context.close();
    }
  }
  for (const title of ['reject', 'lost']) {
    const { context, page } = await fresh('f1');
    await page.locator('input[name=title]').fill(title);
    await page.getByRole('button', { name: 'Create all', exact: true }).click();
    await page.getByRole('alert').waitFor();
    const disabled = await page.getByRole('button', { name: 'Create all', exact: true }).isDisabled();
    assert.equal(disabled, title === 'lost');
    record(`f1-${title}`, { visibleError: await page.getByRole('alert').textContent(), submitDisabled: disabled });
    await context.close();
  }
  for (const scenario of ['cancel', 'failjob', 'status-error']) {
    const { context, page } = await fresh('f2');
    await page.locator('input[name=title]').fill(scenario);
    await page.getByRole('button', { name: 'Create all', exact: true }).click();
    await page.waitForSelector('h3');
    if (scenario === 'cancel') {
      await page.getByRole('button', { name: 'Cancel job' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid=job-state]')?.textContent === 'canceled');
    } else if (scenario === 'failjob') {
      await page.waitForFunction(() => document.querySelector('[data-testid=job-state]')?.textContent === 'failed');
    } else {
      let failures = 0;
      await page.route('**/api/jobs/fixture-*', async route => { if (++failures <= 2) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"status unavailable"}' }); else await route.continue(); });
      await page.getByRole('alert').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid=job-state]')?.textContent === 'completed');
      assert.ok(failures >= 3);
    }
    assert.equal((await stats('/api/jobs')).length, 1);
    record(`f2-${scenario}`, { state: await page.locator('[data-testid=job-state]').textContent(), creationRequests: 1 });
    await context.close();
  }
  await mkdir('tools/perf/frontend/results', { recursive: true });
  await writeFile('tools/perf/frontend/results/browser.json', JSON.stringify(results, null, 2) + '\n');
  console.log(`PASS: ${results.cases.length} observations; baseline requirement failures retained as negative controls.`);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
