// Loads the exact balance code shipped in check.html (<script id="poa-balance-core">) into a Node VM.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './load-core.mjs';

export function loadBalance(extra = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'check.html'), 'utf8');
  const m = html.match(/<script id="poa-balance-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('poa-balance-core script not found');
  const sandbox = { Uint8Array, BigInt, Math, Object, Array, String, Number, Error, Promise, setTimeout, clearTimeout, AbortController, ...extra };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(m[1], sandbox, { filename: 'check.html#poa-balance-core' });
  return sandbox.PoaBalance;
}
