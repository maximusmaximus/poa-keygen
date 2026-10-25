import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBalance } from '../load-balance.mjs';
import { loadCore } from '../load-core.mjs';
import { webcrypto } from 'node:crypto';

const B = loadBalance();
const K = loadCore();
const me = K.generate(webcrypto).address;
const them = K.generate(webcrypto).address;
const cp = { height: 30618 };
const row = (id, from, to, amount, final = 1, atts = 40, ts = 1000, type = 'transfer') => ({ id: id.padEnd(64, '0'), type, from_addr: from, to_addr: to, amount, epoch: null, ts, atts, final });
const covered = { checkpointed: { height: 30618 } };
const open = (atts = 40, final = 1) => ({ final, atts });
const resp = (balance, txs) => ({ address: me, balance, balance_as_of: { checkpoint_height: cp.height }, checkpoint_height: cp.height, txs });

test('address validation and private-key detection', () => {
  assert.equal(B.isAddress(me), true);
  assert.equal(B.isAddress('poa1notvalid'), false);
  assert.equal(B.isAddress(me.slice(4)), false);
  const priv = K.generate(webcrypto).privkey;
  assert.equal(B.looksLikePrivkey(priv), true);
  assert.equal(B.looksLikePrivkey(me), false);
  assert.equal(B.looksLikePrivkey('a'.repeat(64)), false, 'a txid is not a key');
});

test('micros round-trip exactly (no floating point)', () => {
  for (const s of ['0.000000', '0.000001', '100.000000', '8943405.155398', '1865795757.169764']) assert.equal(B.fromMicros(B.toMicros(s)), s);
  assert.equal(B.toMicros(''), null);
  assert.equal(B.fromMicros(B.toMicros('1.5')), '1.500000');
});

test('lagging checkpoint: final incoming transfer after the checkpoint is added (live case: 0 -> 100)', () => {
  const r = B.derive(me, resp('0.000000', [row('a1', them, me, '100.000000')]), { ['a1'.padEnd(64, '0')]: open() });
  assert.equal(r.checkpoint.balance, '0.000000');
  assert.equal(r.checkpoint.height, 30618);
  assert.equal(r.current, '100.000000');
  assert.equal(r.spendable, '100.000000');
  assert.equal(r.txs[0].direction, 'in');
  assert.equal(r.txs[0].inCheckpoint, false);
});

test('outgoing after the checkpoint is subtracted; checkpoint-covered txs are not double counted (Tessellate shape)', () => {
  const txs = [row('o1', me, them, '100.000000', 1, 40, 5000), row('o2', me, them, '100.000000', 1, 40, 4000),
    row('c1', me, them, '5000.000000', 1, 68, 3000), row('c2', them, me, '2.002020', 1, 23, 2000), row('ch', me, '', '', 1, 9, 1000, 'challenge')];
  const d = { ['o1'.padEnd(64, '0')]: open(), ['o2'.padEnd(64, '0')]: open(), ['c1'.padEnd(64, '0')]: covered, ['c2'.padEnd(64, '0')]: covered, ['ch'.padEnd(64, '0')]: covered };
  const r = B.derive(me, resp('8943405.155398', txs), d);
  assert.equal(r.current, '8943205.155398');
  assert.equal(r.sinceCheckpoint.finalOut, '200.000000');
  assert.equal(r.sinceCheckpoint.finalIn, '0.000000');
  assert.equal(r.txs.find(t => t.type === 'challenge').direction, 'other');
  assert.equal(r.lastTxTs, 5000);
  assert.deepEqual([...r.txs.map(t => t.status.via)], ['attestations', 'attestations', 'checkpoint', 'checkpoint', 'checkpoint']);
});

test('pending: incoming is not spendable, outgoing is reserved', () => {
  const txs = [row('p1', them, me, '30.000000', 0, 2, 3000), row('p2', me, them, '10.000000', 0, 1, 2000), row('f1', them, me, '100.000000', 1, 9, 1000)];
  const d = { ['p1'.padEnd(64, '0')]: open(2, 0), ['p2'.padEnd(64, '0')]: open(1, 0), ['f1'.padEnd(64, '0')]: open(9, 1) };
  const r = B.derive(me, resp('5.000000', txs), d);
  assert.equal(r.current, '105.000000');
  assert.equal(r.spendable, '95.000000');
  assert.equal(r.afterPending, '125.000000');
  assert.equal(r.sinceCheckpoint.pendingIn, '30.000000');
  assert.equal(r.sinceCheckpoint.pendingOut, '10.000000');
  assert.equal(r.pendingCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(r.txs[0].status)), { state: 'pending', atts: 2, need: 5, covered: false, stale: false });
});

test('detail newer than the address row wins (row says pending, detail says final)', () => {
  const r = B.derive(me, resp('0.000000', [row('x', them, me, '1.000000', 0, 3)]), { ['x'.padEnd(64, '0')]: { final: 1, atts: 6 } });
  assert.equal(r.txs[0].status.state, 'final');
  assert.equal(r.current, '1.000000');
});

test('"not in segments" detail: flagged as catching up, falls back to the row, never assumed covered', () => {
  const r = B.derive(me, resp('0.000000', [row('y', them, me, '7.000000', 1, 40)]), { ['y'.padEnd(64, '0')]: { error: 'not in segments' } });
  assert.equal(r.catchingUp, true);
  assert.equal(r.current, '7.000000');
  assert.equal(r.txs[0].status.stale, true);
});

test('self-transfers net to zero; spendable never negative', () => {
  const r = B.derive(me, resp('1.000000', [row('s', me, me, '50.000000'), row('z', me, them, '3.000000', 0, 0)]), { ['s'.padEnd(64, '0')]: open(), ['z'.padEnd(64, '0')]: open(0, 0) });
  assert.equal(r.current, '1.000000');
  assert.equal(r.spendable, '0.000000');
});

function fakeFetch(routes, log = []) {
  return async (url, init) => {
    log.push([init && init.method, url]);
    const r = routes(url);
    if (r instanceof Error) throw r;
    return { status: r.status || 200, ok: (r.status || 200) < 400, json: async () => r.body };
  };
}

test('checker: GETs only, caches checkpoint-covered details, re-checks open ones', async () => {
  const log = [];
  const id1 = 'a'.repeat(64), id2 = 'b'.repeat(64);
  const fetch = fakeFetch(url => {
    if (url.includes('/api/explorer/address/')) return { body: resp('0.000000', [row(id1, them, me, '100.000000', 1, 40, 2), row(id2, them, me, '1.000000', 1, 9, 1)]) };
    if (url.endsWith(id1)) return { body: { id: id1, final: 1, atts: 40, memo: '' } };
    if (url.endsWith(id2)) return { body: { id: id2, final: 1, atts: 9, memo: 'hi', checkpointed: { height: 30618 } } };
    return { status: 404, body: { error: 'x' } };
  }, log);
  const c = B.makeChecker({ fetch });
  const r1 = await c.check(me);
  assert.equal(r1.current, '100.000000');
  assert.equal(r1.txs[1].memo, 'hi');
  const n1 = log.length;
  await c.check(me);
  assert.equal(log.length - n1, 2, 'second refresh: address + only the not-yet-checkpointed tx');
  assert.ok(log.every(([m, u]) => m === 'GET' && u.startsWith('https://minepoa.com/api/')));
  assert.ok(log.every(([, u]) => !u.includes('submit')));
});

test('checker: busy / offline / invalid map to distinct error kinds', async () => {
  const busy = B.makeChecker({ fetch: fakeFetch(() => ({ status: 503, body: { error: 'origin busy — retry shortly', retry_after_seconds: 60 } })) });
  await assert.rejects(busy.check(me), e => e.kind === 'busy' && e.retryAfter === 60);
  const seg = B.makeChecker({ fetch: fakeFetch(() => ({ status: 404, body: { error: 'not in segments' } })) });
  await assert.rejects(seg.check(me), e => e.kind === 'busy');
  const off = B.makeChecker({ fetch: fakeFetch(() => new TypeError('Failed to fetch')) });
  await assert.rejects(off.check(me), e => e.kind === 'network');
  await assert.rejects(off.check('poa1nope'), e => e.kind === 'invalid');
});

test('watchTx: not found, included, pending, final', async () => {
  const id = 'c'.repeat(64);
  const mk = (receipt, detail) => B.makeChecker({ fetch: fakeFetch(url => url.includes('/receipt/') ? receipt : detail) });
  const nf = { status: 404, body: { error: 'unknown txid' } };
  assert.equal((await mk(nf, { status: 404, body: { error: 'not in segments' } }).watchTx(id)).state, 'notfound');
  assert.equal((await mk({ body: { status: 'included', height: 5 } }, { status: 404, body: { error: 'not in segments' } }).watchTx(id)).state, 'included');
  assert.equal((await mk({ body: { status: 'rejected' } }, nf).watchTx(id)).state, 'failed');
  assert.equal((await mk({ body: { status: 'included', height: 5 } }, { body: { final: 0, atts: 2 } }).watchTx(id)).state, 'pending');
  const f = await mk({ body: { status: 'included', height: 5 } }, { body: { final: 1, atts: 40, amount: '1.000000', memo: 'm' } }).watchTx(id);
  assert.equal(f.state, 'final'); assert.equal(f.height, 5); assert.equal(f.memo, 'm');
  await assert.rejects(mk(nf, nf).watchTx('nope'), e => e.kind === 'invalid');
});

test('live read-only cross-check against minepoa.com (skipped offline or with POA_LIVE=0)', { skip: process.env.POA_LIVE === '0' }, async (t) => {
  const c = B.makeChecker({ fetch: globalThis.fetch });
  let r;
  try { r = await c.check('poa1AawXL4JWT5RCaAumBR679mWsuNMS7NjU5qcBn4LKM2tr'); } catch (e) { t.skip('minepoa unreachable or busy: ' + e.message); return; }
  // The live identity: current = checkpoint + final in - final out (txs not yet checkpointed).
  const s = r.sinceCheckpoint;
  assert.equal(B.toMicros(r.current), B.toMicros(r.checkpoint.balance) + B.toMicros(s.finalIn) - B.toMicros(s.finalOut));
  assert.ok(B.toMicros(r.current) >= 0n);
});
