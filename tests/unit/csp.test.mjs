import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INDEX, expectedPolicy, currentPolicy } from '../../scripts/csp.mjs';

const html = fs.readFileSync(INDEX, 'utf8');
test('CSP meta is current and forbids all network', () => {
  const csp = currentPolicy(html);
  assert.equal(csp, expectedPolicy(html));
  for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-inline|unsafe-eval|https?:|\*/.test(csp));
});
test('page is self-contained: no external URLs, no network or storage APIs, no console', () => {
  assert.ok(!/\b(src|href)\s*=\s*"(?!data:|#)/i.test(html), 'no external src/href');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'console.', 'innerHTML', 'eval(', 'new Function', 'importScripts', 'Worker(']) {
    assert.ok(!html.includes(bad), `must not contain ${bad}`);
  }
  assert.ok(html.includes('getRandomValues'));
});
