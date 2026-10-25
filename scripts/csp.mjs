#!/usr/bin/env node
// Computes the Content-Security-Policy for each page from sha256 hashes of its inline
// <script> and <style> blocks. `node scripts/csp.mjs` rewrites the meta tags;
// `node scripts/csp.mjs --check` exits 1 if a committed policy is stale.
//
//   index.html  key generator: connect-src 'none' (no network at all, works offline)
//   check.html  balance checker: connect-src https://minepoa.com only (read-only explorer GETs)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX = path.join(root, 'index.html');
export const CHECK = path.join(root, 'check.html');
export const MINEPOA = 'https://minepoa.com';
const h = s => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

export function expectedPolicy(html, { connect = "'none'" } = {}) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => h(m[1]));
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => h(m[1]));
  return [
    "default-src 'none'",
    `script-src ${scripts.join(' ')}`,
    `style-src ${styles.join(' ')}`,
    'img-src data:',
    `connect-src ${connect}`,
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
export const PAGES = [
  { file: INDEX, connect: "'none'" },
  { file: CHECK, connect: MINEPOA },
];
const META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/;
export function currentPolicy(html) { const m = html.match(META); return m ? m[2] : null; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stale = false;
  for (const p of PAGES) {
    const html = fs.readFileSync(p.file, 'utf8');
    const want = expectedPolicy(html, p);
    const name = path.basename(p.file);
    if (process.argv.includes('--check')) {
      if (currentPolicy(html) !== want) { console.error(`${name}: CSP meta is stale: run \`node scripts/csp.mjs\``); stale = true; }
      else console.log(`${name}: CSP meta is up to date`);
    } else {
      fs.writeFileSync(p.file, html.replace(META, `$1${want}$3`));
      console.log(`${name}: ${want}`);
    }
  }
  if (stale) process.exit(1);
}
