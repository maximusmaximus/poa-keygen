import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INDEX, CHECK, MINEPOA, expectedPolicy, currentPolicy } from '../../scripts/csp.mjs';

const html = fs.readFileSync(INDEX, 'utf8');
test('CSP meta is current and forbids all network', () => {
  const csp = currentPolicy(html);
  assert.equal(csp, expectedPolicy(html));
  for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-inline|unsafe-eval|https?:|\*/.test(csp));
});
test('page is self-contained: no external URLs, no network or storage APIs, no console', () => {
  // The only link is the user-clicked "Check live balance" link to the separate checker page.
  assert.ok(!/\b(src|href)\s*=\s*"(?!data:|#|check\.html")/i.test(html), 'no external src/href');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'console.', 'innerHTML', 'eval(', 'new Function', 'importScripts', 'Worker(']) {
    assert.ok(!html.includes(bad), `must not contain ${bad}`);
  }
  assert.ok(html.includes('getRandomValues'));
});

const check = fs.readFileSync(CHECK, 'utf8');
test('balance checker CSP is current and can reach minepoa.com only', () => {
  const csp = currentPolicy(check);
  assert.equal(csp, expectedPolicy(check, { connect: MINEPOA }));
  assert.match(csp, /connect-src https:\/\/minepoa\.com;/);
  for (const d of ["default-src 'none'", "form-action 'none'", "base-uri 'none'", "img-src data:", "frame-src 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp));
  assert.equal((csp.match(/https?:/g) || []).length, 1, 'exactly one allowed origin');
});
test('balance checker is read-only and keyless: GET only, no storage, no key handling, no console', () => {
  assert.ok(!/\b(src|href)\s*=\s*"(?!data:|#|index\.html")/i.test(check), 'no external src/href');
  for (const bad of ['XMLHttpRequest', 'WebSocket', 'sendBeacon', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'console.', 'innerHTML', 'eval(', 'new Function', 'privkey', "method: 'POST'", "+ '/api/submit", 'style="']) {
    assert.ok(!check.includes(bad), `must not contain ${bad}`);
  }
  assert.ok(check.includes("method: 'GET'"));
});
test('generator links to the checker with the address in the URL fragment only', () => {
  assert.ok(html.includes("'#' + current.address"));
  assert.ok(!/[?&]address=/.test(html), 'address is never put in a query string');
});
