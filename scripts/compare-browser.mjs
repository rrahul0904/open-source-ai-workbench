/** Separate real-Chromium accessibility and EventSource check. Install the pinned
 * Playwright/axe test dependencies in CI; the runtime itself remains dependency-free. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const port = 3198;
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, WORKBENCH_API_KEY: '', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let browser;
try {
  let alive = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error('HTTP process exited early');
    try {
      alive = (await fetch(origin + '/api/health')).ok;
      if (alive) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(alive, 'comparison server starts');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const response = await page.goto(origin + '/compare.html');
  assert.equal(response.status(), 200);
  assert.match(await page.title(), /Synthetic comparison/);
  await page.keyboard.press('Tab');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Skip to comparison/);
  assert.equal(await page.getByRole('textbox', { name: 'Comparison prompt' }).count(), 1);
  assert.equal(await page.getByRole('group', { name: 'Choose demo adapters (at least one)' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Cancel current comparison' }).isDisabled(), true);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(audit.violations.filter((item) =>
    item.impact === 'critical' || item.impact === 'serious').map((item) => item.id), []);
  await page.getByRole('textbox', { name: 'Comparison prompt' }).fill('Outline a synthetic ETL validation plan');
  await page.getByRole('button', { name: 'Start synthetic comparison' }).click();
  await page.getByRole('status').filter({ hasText: 'No synthesis or factual verification' })
    .waitFor({ timeout: 10000 });
  assert.equal(await page.locator('.lane:not([hidden])').count(), 4);
  assert.equal(await page.locator('.lane [data-status]:text-is("Completed")').count(), 4);
  assert.match(await page.locator('[data-model="demo-analysis"] [data-output]').textContent(), /synthetic:/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.locator('.lane:not([hidden])').count(), 4);
  // Drop the first SSE connection. Native EventSource retries and the server replays
  // in run-local ID order; no duplicate synthetic text should be appended.
  let disconnected = false;
  await page.route('**/api/compare/runs/*/events', (route) => {
    if (!disconnected) { disconnected = true; return route.abort('failed'); }
    return route.continue();
  });
  await page.getByRole('textbox', { name: 'Comparison prompt' }).fill('Test an interrupted comparison');
  await page.getByRole('button', { name: 'Start synthetic comparison' }).click();
  await page.getByRole('status').filter({ hasText: 'No synthesis or factual verification' })
    .waitFor({ timeout: 15000 });
  assert.equal(disconnected, true);
  assert.equal(await page.locator('.lane [data-status]:text-is("Completed")').count(), 4);
  assert.deepEqual(pageErrors, []);
  console.log('compare-browser: Chromium keyboard, accessible names, axe serious/critical, mobile and interrupted SSE passed');
} finally {
  await browser?.close();
  child.kill('SIGTERM');
}
