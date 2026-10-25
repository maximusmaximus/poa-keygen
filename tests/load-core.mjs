// Loads the exact derivation code shipped in index.html (<script id="poa-core">) into a Node VM.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadCore() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script id="poa-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('poa-core script not found');
  const sandbox = { crypto: webcrypto, Uint8Array, BigInt, Math, Object, Array, String, Number, Error };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(m[1], sandbox, { filename: 'index.html#poa-core' });
  return sandbox.PoaKeygen;
}
