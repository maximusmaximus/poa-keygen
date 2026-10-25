import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { ROOT, instrument, openPage, ADDR } from './helpers.mjs';
import { loadCore } from '../load-core.mjs';

const CHECK_URL = pathToFileURL(path.join(ROOT, 'check.html')).href;
const K = loadCore();
const ME = K.generate(webcrypto).address;
const THEM = K.generate(webcrypto).address;
const ID_IN = 'a'.repeat(64), ID_OUT = 'b'.repeat(64), ID_OLD = 'c'.repeat(64);

// Mock of the public minepoa.com explorer. Starts with a lagging checkpoint (0) plus a final
// incoming 100, a pending outgoing 10 and one checkpoint-covered tx; `state.outFinal` flips later.
async function mockMinepoa(context, state = {}) {
  const log = [];
  await context.route('https://minepoa.com/**', async route => {
    const req = route.request(), url = req.url();
    log.push(req.method() + ' ' + url);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (state.busy) return json({ error: 'origin busy — retry shortly', retry_after_seconds: 5 }, 503);
    if (url.includes('/api/explorer/address/')) {
      return json({ address: ME, balance: '0.000000', balance_as_of: { checkpoint_height: 30618 }, checkpoint_height: 30618, as_of: new Date().toISOString(), txs: [
        { id: ID_OUT, type: 'transfer', from_addr: ME, to_addr: THEM, amount: '10.000000', epoch: null, ts: 1792965000, atts: state.outFinal ? 6 : 2, final: state.outFinal ? 1 : 0 },
        { id: ID_IN, type: 'transfer', from_addr: THEM, to_addr: ME, amount: '100.000000', epoch: null, ts: 1792964179, atts: 40, final: 1 },
        { id: ID_OLD, type: 'challenge', from_addr: ME, to_addr: '', amount: '', epoch: 4, ts: 1792945204, atts: 9, final: 1 },
      ] });
    }
    if (url.endsWith('/api/explorer/tx/' + ID_IN)) return json({ id: ID_IN, final: 1, atts: 40, memo: '' });
    if (url.endsWith('/api/explorer/tx/' + ID_OUT)) return json(state.outFinal ? { id: ID_OUT, final: 1, atts: 6, memo: '' } : { id: ID_OUT, final: 0, atts: 2, memo: '' });
    if (url.endsWith('/api/explorer/tx/' + ID_OLD)) return json({ id: ID_OLD, final: 1, atts: 9, memo: '', checkpointed: { height: 30618 } });
    if (url.includes('/api/receipt/' + ID_OUT)) return json({ txid: ID_OUT, status: 'included', height: 1100 });
    return json({ error: 'unknown txid — not seen by this node' }, 404);
  });
  return log;
}

test.describe('smoke: balance checker', () => {
  test('lagging checkpoint, pending vs final, live refresh, GETs to minepoa.com only', async ({ page, context }) => {
    await page.clock.install();
    const errors = await instrument(page);
    const state = {};
    const log = await mockMinepoa(context, state);
    await page.goto(CHECK_URL + '#' + ME);
    await expect(page.locator('#v-spendable')).toHaveText('90.000000 POA');
    await expect(page.locator('#v-current')).toHaveText('100.000000 POA');
    await expect(page.locator('#v-cp')).toHaveText('0.000000 POA');
    await expect(page.locator('#v-cp-d')).toContainText('h30618');
    await expect(page.locator('#v-pout')).toHaveText('10.000000 POA');
    await expect(page.locator('#v-pin')).toHaveText('0.000000 POA');
    await expect(page.locator('#txs .tx')).toHaveCount(3);
    await expect(page.locator('#txs .tx').nth(0).locator('.badge')).toHaveText('⏳ Pending · 2/5');
    await expect(page.locator('#txs .tx').nth(1).locator('.badge')).toHaveText('✓ Final · 40 confirmations');
    await expect(page.locator('#txs .tx').nth(2).locator('.badge')).toHaveText('✓ Final · checkpoint h30618');
    await expect(page.locator('#net-notice')).toHaveAttribute('data-state', 'live');
    await expect(page.locator('#updated')).toContainText('Live · updated');

    state.outFinal = true;
    await page.clock.runFor(16000);
    await expect(page.locator('#txs .tx').nth(0).locator('.badge')).toHaveText('✓ Final · 6 confirmations');
    await expect(page.locator('#v-spendable')).toHaveText('90.000000 POA');
    await expect(page.locator('#v-pout')).toHaveText('0.000000 POA');

    expect(log.length).toBeGreaterThan(0);
    for (const l of log) expect(l).toMatch(/^GET https:\/\/minepoa\.com\/api\/(explorer|receipt)\//);
    expect(log.some(l => l.includes('/api/submit'))).toBe(false);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('offline: clear notice, no stale numbers, recovers when back online', async ({ page, context }) => {
    await mockMinepoa(context);
    await page.goto(CHECK_URL + '#' + ME);
    await expect(page.locator('#v-spendable')).toHaveText('90.000000 POA');
    await context.setOffline(true);
    await expect(page.locator('#net-notice')).toHaveAttribute('data-state', 'offline');
    await expect(page.locator('#net-title')).toHaveText("You're offline");
    await expect(page.locator('#net-text')).toContainText("can't be checked until you reconnect");
    await expect(page.locator('#result')).toBeHidden();
    await context.setOffline(false);
    await expect(page.locator('#v-spendable')).toHaveText('90.000000 POA');
    await expect(page.locator('#net-notice')).toHaveAttribute('data-state', 'live');
  });

  test('ledger catching up (503) shows a retry state', async ({ page, context }) => {
    await mockMinepoa(context, { busy: true });
    await page.goto(CHECK_URL + '#' + ME);
    await expect(page.locator('#net-notice')).toHaveAttribute('data-state', 'busy');
    await expect(page.locator('#net-title')).toHaveText('The ledger is catching up');
  });

  test('a pasted private key is refused, cleared and never sent', async ({ page, context }) => {
    const log = await mockMinepoa(context);
    await page.goto(CHECK_URL);
    await expect(page.locator('#net-title')).toHaveText('Needs an internet connection');
    const priv = K.generate(webcrypto).privkey;
    await page.locator('#addr').fill(priv);
    await expect(page.locator('#addr-err')).toContainText('looks like a private key');
    await expect(page.locator('#addr')).toHaveValue('');
    expect(log.join('\n').includes(priv)).toBe(false);
    expect(log).toEqual([]);
  });

  test('track a transaction by txid', async ({ page, context }) => {
    await mockMinepoa(context);
    await page.goto(CHECK_URL);
    await page.locator('#wtx').fill(ID_OUT);
    await page.getByRole('button', { name: 'Track' }).click();
    await expect(page.locator('#wout .badge')).toHaveText('⏳ Pending · 2/5');
    await page.locator('#wtx').fill('d'.repeat(64));
    await page.getByRole('button', { name: 'Track' }).click();
    await expect(page.locator('#wout .badge')).toHaveText('? Not found');
  });

  test('generator links to the checker with the new address in the fragment', async ({ page }) => {
    await openPage(page);
    const addr = (await page.getByTestId('address').textContent()).trim();
    const link = page.getByRole('link', { name: /Check live balance/ });
    await expect(link).toHaveAttribute('href', 'https://maximusmaximus.github.io/poa-keygen/check.html#' + addr);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noreferrer/);
    await page.getByRole('button', { name: 'Generate new pair' }).click();
    const addr2 = (await page.getByTestId('address').textContent()).trim();
    expect(addr2).toMatch(ADDR);
    await expect(link).toHaveAttribute('href', new RegExp('#' + addr2 + '$'));
  });

  test('layout: no horizontal overflow, tap targets', async ({ page, context }) => {
    await mockMinepoa(context);
    await page.goto(CHECK_URL + '#' + ME);
    await expect(page.locator('#v-spendable')).toHaveText('90.000000 POA');
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
      go: document.getElementById('go').getBoundingClientRect().height }));
    expect(m.sw).toBeLessThanOrEqual(m.vw);
    expect(m.go).toBeGreaterThanOrEqual(44);
  });
});
