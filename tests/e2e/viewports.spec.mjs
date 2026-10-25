import { test, expect } from '@playwright/test';
import path from 'node:path';
import { ROOT, SHAPES, trackRequests, instrument, openPage } from './helpers.mjs';

export const VIEWPORTS = [
  ['320x568', 320, 568], ['375x667', 375, 667], ['414x896', 414, 896],
  ['390x844-portrait', 390, 844], ['844x390-landscape', 844, 390], ['568x320-landscape', 568, 320],
  ['768x1024', 768, 1024], ['1024x768', 1024, 768], ['1280x800', 1280, 800], ['1920x1080', 1920, 1080],
];

// Desktop engine projects sweep every size below; mobile device projects (real UA, DPR, touch,
// portrait + landscape) run only the "@device" test at their native viewport (see playwright.config.mjs).
const CASES = [...VIEWPORTS, ['@device', 0, 0]];
for (const [label, width, height] of CASES) {
  test(`layout @ ${label}`, async ({ page, context }, info) => {
    if (width) await page.setViewportSize({ width, height });
    const extra = trackRequests(context);
    const errors = await instrument(page);
    await openPage(page);
    const name = width ? label : 'device-' + Object.values(page.viewportSize()).join('x');

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const els = ['address', 'privkey', 'reveal', 'copy-address', 'copy-key', 'copy-both', 'generate', 'download'].map(id => {
        const el = document.getElementById(id), r = el.getBoundingClientRect();
        return { id, left: r.left, right: r.right, h: r.height, w: r.width, sw: el.scrollWidth, cw: el.clientWidth };
      });
      return { sw: de.scrollWidth, vw: de.clientWidth, els };
    });
    expect(m.sw, 'no horizontal page overflow').toBeLessThanOrEqual(m.vw);
    for (const e of m.els) {
      expect(e.left, `${e.id} inside viewport`).toBeGreaterThanOrEqual(0);
      expect(e.right, `${e.id} inside viewport`).toBeLessThanOrEqual(m.vw + 0.5);
      expect(e.sw, `${e.id} content not clipped`).toBeLessThanOrEqual(e.cw + 1);
      expect(e.w, `${e.id} has size`).toBeGreaterThan(40);
    }
    for (const id of ['reveal', 'copy-address', 'copy-key', 'copy-both', 'generate', 'download'])
      expect(m.els.find(e => e.id === id).h, `${id} >= 44px tap target`).toBeGreaterThanOrEqual(44);

    for (const n of ['Copy address', 'Copy private key', 'Copy both', 'Generate new pair', 'Show private key']) {
      const b = page.getByRole('button', { name: n, exact: true });
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeVisible();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByTestId('privkey').locator('[aria-hidden="true"]')).toHaveText(SHAPES);
    // CSP check before screenshots: WebKit reports Playwright's own injected screenshot styles as violations.
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    expect(errors).toEqual([]);
    const shotNoise = e => /Refused to apply a stylesheet/.test(e); // Playwright's screenshot <style>, blocked by our CSP in WebKit
    const dir = path.join(ROOT, 'screenshots', info.project.name);
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
    await page.screenshot({ path: path.join(dir, `${name}-full.png`), fullPage: true });

    // Revealed key must also wrap inside its field without overflow.
    await page.getByRole('button', { name: 'Show private key' }).click();
    const k = await page.evaluate(() => { const el = document.getElementById('privkey'); return { sw: el.scrollWidth, cw: el.clientWidth, dw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }; });
    expect(k.sw).toBeLessThanOrEqual(k.cw + 1);
    expect(k.dw).toBeLessThanOrEqual(k.vw);
    await page.getByRole('button', { name: 'Hide private key' }).click();
    expect(errors.filter(e => !shotNoise(e))).toEqual([]);
    expect(extra).toEqual([]);
  });
}
