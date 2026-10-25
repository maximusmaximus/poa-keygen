import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCore, ROOT } from '../load-core.mjs';
import { refPub, refAddr, refB58, signVerifies } from '../node-ref.mjs';

const K = loadCore();
const hex = u => Buffer.from(u).toString('hex');
const fromHex = h => new Uint8Array(Buffer.from(h, 'hex'));

test('SHA-512 matches FIPS 180-4 vectors and Node across lengths', () => {
  assert.equal(hex(K.sha512(new Uint8Array(0))), 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e');
  assert.equal(hex(K.sha512(new TextEncoder().encode('abc'))), 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
  for (let len = 0; len <= 300; len++) {
    const m = crypto.randomBytes(len);
    assert.equal(hex(K.sha512(new Uint8Array(m))), crypto.createHash('sha512').update(m).digest('hex'), `len ${len}`);
  }
});

test('ed25519 public keys match RFC 8032 section 7.1 test vectors', () => {
  const v = [
    ['9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'],
    ['4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'],
    ['c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025'],
  ];
  for (const [seed, pub] of v) assert.equal(hex(K.pubFromSeed(fromHex(seed))), pub);
});

test('base58 matches standard (Bitcoin alphabet) vectors and round-trips', () => {
  assert.equal(K.b58enc(new TextEncoder().encode('Hello World!')), '2NEpo7TZRRrLZSi2U');
  assert.equal(K.b58enc(fromHex('0000287fb4cd')), '11233QC4');
  assert.equal(K.b58enc(fromHex('00')), '1');
  for (let i = 0; i < 300; i++) {
    const b = crypto.randomBytes(32); if (i % 10 === 0) b[0] = 0; if (i % 30 === 0) b[1] = 0;
    const s = K.b58enc(new Uint8Array(b));
    assert.equal(s, refB58(b));
    assert.equal(hex(K.b58dec(s)), b.toString('hex'));
  }
});

test('known-answer test: official PoA client wallets (poa.mjs init-wallet)', () => {
  const { vectors } = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/vectors/official-client.json'), 'utf8'));
  assert.ok(vectors.length >= 10);
  for (const w of vectors) {
    const p = K.fromPrivkey(w.privkey);
    assert.equal(p.address, w.address);
    assert.equal(p.pubkey, w.pubkey);
    assert.equal(p.privkey, w.privkey);
    assert.ok(signVerifies(w.privkey, w.address));
  }
});

test('500 random seeds: page derivation == Node/OpenSSL ed25519 + official encoding', () => {
  for (let i = 0; i < 500; i++) {
    const seed = crypto.randomBytes(32); if (i % 50 === 0) seed[0] = 0;
    const p = K.pairFromSeed(new Uint8Array(seed));
    const pub = refPub(seed);
    assert.equal(p.address, refAddr(pub));
    assert.equal(p.pubkey, refB58(pub));
    assert.equal(p.privkey, refB58(seed));
  }
});

test('generate() uses getRandomValues, gives distinct valid pairs and wipes the seed', () => {
  let seen; const spy = { getRandomValues: a => { crypto.getRandomValues(a); seen = a; return a; } };
  const seenAddrs = new Set();
  for (let i = 0; i < 50; i++) {
    const p = K.generate(spy);
    assert.match(p.address, /^poa1[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.equal(K.pubOfAddr(p.address).length, 32);
    assert.equal(K.b58dec(p.privkey).length, 32);
    assert.ok(signVerifies(p.privkey, p.address));
    assert.ok(seen.every(b => b === 0), 'seed buffer wiped');
    seenAddrs.add(p.address);
  }
  assert.equal(seenAddrs.size, 50);
  assert.throws(() => K.generate({}), /getRandomValues/);
});

test('input validation', () => {
  assert.throws(() => K.pubFromSeed(new Uint8Array(31)));
  assert.throws(() => K.fromPrivkey('1111'));
  assert.throws(() => K.fromPrivkey('0OIl'));
  assert.throws(() => K.pubOfAddr('poa2abc'));
  assert.throws(() => K.pubOfAddr('poa1' + '2'.repeat(10)));
});

// Optional live cross-check against the CURRENT official client. Skipped offline / when unreachable.
test('live: current minepoa.com/client/poa.mjs agrees (skips if unreachable)', async t => {
  if (process.env.POA_SKIP_LIVE) return t.skip('POA_SKIP_LIVE set');
  let src;
  if (process.env.POA_OFFICIAL_CLIENT) src = fs.readFileSync(process.env.POA_OFFICIAL_CLIENT, 'utf8');
  else try { const r = await fetch('https://minepoa.com/client/poa.mjs', { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(String(r.status)); src = await r.text(); }
  catch (e) { return t.skip('official client unreachable: ' + e.message); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poa-'));
  const file = path.join(tmp, 'poa.mjs'); fs.writeFileSync(file, src);
  try {
    const off = await import('file://' + file);
    for (let i = 0; i < 25; i++) {
      const { pubRaw, privRaw } = off.genKeypair();
      const p = K.pairFromSeed(new Uint8Array(privRaw));
      assert.equal(p.address, off.addrOf(pubRaw));
      assert.equal(p.privkey, off.b58enc(privRaw));
      assert.equal(hex(off.pubOfAddr(p.address)), hex(pubRaw));
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
