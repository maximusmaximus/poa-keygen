#!/usr/bin/env node
// Computes the Content-Security-Policy for index.html from sha256 hashes of its inline
// <script> and <style> blocks. `node scripts/csp.mjs` rewrites the meta tag;
// `node scripts/csp.mjs --check` exits 1 if the committed policy is stale.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX = path.join(root, 'index.html');
const h = s => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

export function expectedPolicy(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => h(m[1]));
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => h(m[1]));
  return [
    "default-src 'none'",
    `script-src ${scripts.join(' ')}`,
    `style-src ${styles.join(' ')}`,
    'img-src data:',
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}
const META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/;
export function currentPolicy(html) { const m = html.match(META); return m ? m[2] : null; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = fs.readFileSync(INDEX, 'utf8');
  const want = expectedPolicy(html);
  if (process.argv.includes('--check')) {
    if (currentPolicy(html) !== want) { console.error('CSP meta is stale: run `node scripts/csp.mjs`'); process.exit(1); }
    console.log('CSP meta is up to date');
  } else {
    fs.writeFileSync(INDEX, html.replace(META, `$1${want}$3`));
    console.log(want);
  }
}
