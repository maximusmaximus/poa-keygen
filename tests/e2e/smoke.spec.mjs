import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import { PAGE_URL, ROOT, SHAPES, ADDR, PRIV, trackRequests, instrument, openPage, readKey, assertClean } from './helpers.mjs';
import { signVerifies } from '../node-ref.mjs';
import path from 'node:path';

test.describe('smoke', () => {
  test('loads from file://, masks the key by default, reveal works, pair is valid', async ({ page, context }) => {
    const extra = trackRequests(context);
    const errors = await instrument(page);
    await openPage(page);

    const key = page.getByTestId('privkey');
    await expect(key).toHaveText(/^[●◆▲■]+Hidden$/);
    await expect(key.locator('[aria-hidden="true"]')).toHaveText(SHAPES);
    await expect(page.getByRole('button', { name: 'Show private key' })).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: 'Show private key' }).click();
    await expect(key).toHaveText(PRIV);
    await expect(page.getByRole('button', { name: 'Hide private key' })).toHaveAttribute('aria-pressed', 'true');
    const priv = (await key.textContent()).trim();
    const addr = (await page.getByTestId('address').textContent()).trim();
    expect(signVerifies(priv, addr)).toBe(true); // Node/OpenSSL ed25519 agrees the key controls the address

    await page.getByRole('button', { name: 'Hide private key' }).click();
    await expect(key.locator('[aria-hidden="true"]')).toHaveText(SHAPES);
    // While masked, the secret is nowhere in the DOM (text or attributes); only the address is plain.
    const html = await page.content();
    expect(html.includes(priv)).toBe(false);
    expect(html.includes(addr)).toBe(true);

    await page.getByRole('button', { name: 'Generate new pair' }).click();
    await expect(page.getByTestId('address')).not.toHaveText(addr);
    await expect(page.getByTestId('address')).toHaveText(ADDR);
    await expect(key.locator('[aria-hidden="true"]')).toHaveText(SHAPES);
    await assertClean(page, errors, extra);
  });

  test('re-masks when the tab is hidden and after the auto-hide timer', async ({ page }) => {
    await page.clock.install();
    await openPage(page);
    const key = page.getByTestId('privkey');
    await page.getByRole('button', { name: 'Show private key' }).click();
    await expect(key).toHaveText(PRIV);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(key.locator('[aria-hidden="true"]')).toHaveText(SHAPES);
    await page.evaluate(() => { delete document.hidden; });

    await page.getByRole('button', { name: 'Show private key' }).click();
    await expect(key).toHaveText(PRIV);
    await page.clock.runFor(31000);
    await expect(key.locator('[aria-hidden="true"]')).toHaveText(SHAPES);
  });

  test('all three copy buttons put the right text on the clipboard', async ({ page, context, browserName }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const extra = trackRequests(context);
    const errors = await instrument(page);
    await openPage(page);
    const addr = (await page.getByTestId('address').textContent()).trim();
    const priv = await readKey(page);

    // Read back through a real paste into a scratch textarea (works in every engine).
    const paste = async () => page.evaluate(() => new Promise(resolve => {
      const ta = document.createElement('textarea'); document.body.appendChild(ta); ta.focus();
      ta.addEventListener('paste', e => { const t = e.clipboardData.getData('text/plain'); ta.remove(); resolve(t); }, { once: true });
    })).then(x => x);
    const pasted = async () => { const p = paste(); await page.waitForTimeout(50); await page.keyboard.press('ControlOrMeta+V'); return p; };

    const cases = [
      ['Copy address', addr],
      ['Copy private key', priv],
      ['Copy both', `PoA address: ${addr}\nPoA private key: ${priv}`],
    ];
    for (const [name, want] of cases) {
      const btn = page.getByRole('button', { name, exact: true });
      await btn.click();
      await expect(page.getByRole('button', { name: '✓ Copied' })).toBeVisible();
      await expect(page.locator('#live')).toContainText('copied');
      if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(want);
      expect(await pasted()).toBe(want);
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible({ timeout: 4000 });
    }
    await expect(page.getByTestId('privkey').locator('[aria-hidden="true"]')).toHaveText(SHAPES);
    await assertClean(page, errors, extra);
  });

  test('clipboard fallback: no Clipboard API -> execCommand; both blocked -> manual dialog', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined }); });
    await openPage(page);
    const addr = (await page.getByTestId('address').textContent()).trim();
    await page.getByRole('button', { name: 'Copy address', exact: true }).click();
    await expect(page.getByRole('button', { name: '✓ Copied' })).toBeVisible();

    await page.evaluate(() => { document.execCommand = () => false; });
    await page.getByRole('button', { name: 'Copy both', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Copy manually' });
    await expect(dlg).toBeVisible();
    const text = await dlg.locator('textarea').inputValue();
    expect(text.split('\n')[0]).toBe(`PoA address: ${addr}`);
    expect(text.split('\n')[1]).toMatch(/^PoA private key: [1-9A-HJ-NP-Za-km-z]{32,44}$/);
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(dlg).toBeHidden();
    expect(await page.locator('#manual-text').inputValue()).toBe('');
  });

  test('Download wallet.json matches the official client wallet format', async ({ page }) => {
    await openPage(page);
    const addr = (await page.getByTestId('address').textContent()).trim();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download wallet.json' }).click()]);
    expect(dl.suggestedFilename()).toBe('wallet.json');
    const w = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    expect(Object.keys(w)).toEqual(['version', 'address', 'pubkey', 'privkey', 'created', 'invited_by']);
    expect(w.version).toBe(1);
    expect(w.address).toBe(addr);
    expect(w.address).toBe('poa1' + w.pubkey);
    expect(signVerifies(w.privkey, w.address)).toBe(true);
  });

  test('works offline and with every network request blocked (served over http)', async ({ page, context }) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'));
    const server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
      else { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    try {
      const extra = trackRequests(context, url);
      const errors = await instrument(page);
      await context.route('**/*', route => (route.request().url() === url ? route.continue() : route.abort()));
      await openPage(page, url);
      await context.setOffline(true);
      await expect(page.locator('#pill-online')).toHaveAttribute('data-online', 'offline');
      await expect(page.locator('#pill-online')).toHaveText('✓ Device is offline');
      const before = await page.getByTestId('address').textContent();
      await page.getByRole('button', { name: 'Generate new pair' }).click();
      await expect(page.getByTestId('address')).not.toHaveText(before);
      const priv = await readKey(page);
      expect(signVerifies(priv, (await page.getByTestId('address').textContent()).trim())).toBe(true);
      await page.waitForTimeout(500); // let any late favicon/prefetch attempt surface
      await assertClean(page, errors, extra);
    } finally { await context.setOffline(false); server.close(); }
  });

  test('file:// page loads with the browser already offline', async ({ page, context, browserName }) => {
    // Playwright's WebKit offline emulation also refuses file:// navigations (a harness limit, not the page);
    // WebKit's offline behaviour is still covered by the http test above, which goes offline after load.
    test.skip(browserName === 'webkit', 'Playwright WebKit cannot navigate file:// while emulating offline');
    await context.setOffline(true);
    const extra = trackRequests(context);
    await openPage(page, PAGE_URL);
    await page.getByRole('button', { name: 'Generate new pair' }).click();
    await expect(page.getByTestId('address')).toHaveText(ADDR);
    expect(extra).toEqual([]);
    await context.setOffline(false);
  });

  test('CSP really blocks network: an injected fetch is refused', async ({ page }) => {
    await openPage(page);
    // Use the DevTools evaluate channel (not page script) to try a connection; CSP must refuse it.
    const result = await page.evaluate(() => fetch('https://example.com/').then(() => 'connected', e => 'blocked: ' + e.name));
    expect(result).toMatch(/^blocked/);
  });
});
