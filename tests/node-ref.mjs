// Independent reference: Node's built-in (OpenSSL) ed25519, using the same raw-key
// wrapping as the official client (minepoa.com/client/poa.mjs genKeypair / addrOf).
import crypto from 'node:crypto';
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function refB58(buf) { let n = 0n; for (const b of buf) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b === 0) s = '1' + s; else break; } return s || '1'; }
export function refB58dec(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad'); n = n * 58n + BigInt(i); } let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex; const buf = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex'); let z = 0; for (const c of s) { if (c === '1') z++; else break; } return Buffer.concat([Buffer.alloc(z), buf]); }
export function refPub(seed) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]), format: 'der', type: 'pkcs8' });
  return Buffer.from(crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(12));
}
export const refAddr = pub => 'poa1' + refB58(pub);
// Proves the private key controls the address: sign with the seed, verify with the address's key.
export function signVerifies(privB58, address) {
  const seed = refB58dec(privB58);
  if (seed.length !== 32) return false;
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const pubRaw = refB58dec(address.slice(4));
  if (!address.startsWith('poa1') || pubRaw.length !== 32) return false;
  const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pubRaw]), format: 'der', type: 'spki' });
  const msg = Buffer.from('poa-keygen self-test');
  return crypto.verify(null, msg, pub, crypto.sign(null, msg, priv));
}
