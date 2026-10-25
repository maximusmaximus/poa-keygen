import { expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
export const SHAPES = /^[●◆▲■]+$/;
export const ADDR = /^poa1[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const PRIV = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Any request other than the page document itself (data:/blob: are in-memory, not network) fails the test.
export function trackRequests(target, pageUrl = PAGE_URL) {
  const extra = [];
  const ok = u => u === pageUrl || u.startsWith('data:') || u.startsWith('blob:');
  target.on('request', r => { if (!ok(r.url())) extra.push(r.method() + ' ' + r.url()); });
  return extra;
}

// Records CSP violations and page errors (proves the hash-only CSP doesn't break the page).
export async function instrument(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  return errors;
}

export async function openPage(page, url = PAGE_URL) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('address')).toHaveText(ADDR);
}

export async function readKey(page) {
  const btn = page.getByRole('button', { name: 'Show private key' });
  await btn.click();
  const key = (await page.getByTestId('privkey').textContent()).trim();
  await page.getByRole('button', { name: 'Hide private key' }).click();
  return key;
}

export async function assertClean(page, errors, extra) {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(errors).toEqual([]);
  expect(extra).toEqual([]);
}
