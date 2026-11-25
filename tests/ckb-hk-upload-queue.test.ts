/** CKB housekeeping offline photo queue (lib/ckb/hk-upload-queue.ts): which photo goes next and what an answer means. */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { afterAttempt, backoffMs, blocksSubmit, classify, nextToSend, queuedCount, summarize, type QueueMeta } from '../lib/ckb/hk-upload-queue';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const item = (o: Partial<QueueMeta>): QueueMeta => ({
  id: 'i1', checkinId: 'c1', kind: 'BEFORE', createdAt: 1000, attempts: 0, maybeSent: false, state: 'PENDING', error: null, nextAt: 0, ...o,
});

console.log('\nCKB housekeeping upload queue');

test('an answer: 2xx is sent, no answer and server trouble are retried, a rule refusal is final', () => {
  assert.equal(classify({ status: 200, maybeSent: false }).outcome, 'DONE');
  assert.equal(classify({ status: null, maybeSent: true }).outcome, 'RETRY');
  assert.equal(classify({ status: 502, maybeSent: false }).outcome, 'RETRY');
  assert.equal(classify({ status: 503, maybeSent: false }).outcome, 'RETRY');
  assert.equal(classify({ status: 429, maybeSent: false }).outcome, 'RETRY');
  const f = classify({ status: 400, error: 'Maksimal 3 foto sebelum per check-in', maybeSent: false });
  assert.deepEqual([f.outcome, f.message], ['FAILED', 'Maksimal 3 foto sebelum per check-in']);
  assert.equal(classify({ status: 404, maybeSent: false }).outcome, 'FAILED');
  assert.equal(classify({ status: 413, maybeSent: false }).message, 'Foto ditolak.');
});

test('an expired session keeps the photo and asks to sign in again', () => {
  for (const s of [401, 403]) { const r = classify({ status: s, maybeSent: false }); assert.equal(r.outcome, 'RETRY'); assert.match(r.message!, /Masuk lagi/); }
});

test('the same file refused: sent already when an earlier answer was lost, a real refusal when it never left the phone', () => {
  const dup = 'Foto ini sudah pernah dipakai (file yang sama). Ambil foto baru.';
  assert.equal(classify({ status: 400, error: dup, maybeSent: true }).outcome, 'DONE');
  const never = classify({ status: 400, error: dup, maybeSent: false });
  assert.deepEqual([never.outcome, never.message], ['FAILED', dup]);
});

test('a time-gap rule is waited out, not final', () => {
  assert.equal(classify({ status: 400, error: 'Foto sesudah baru bisa diambil 5 menit setelah foto sebelum', maybeSent: false }).outcome, 'RETRY');
});

test('backoff doubles from 5 seconds and stops at 5 minutes', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs), [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
  assert.equal(backoffMs(-3), 5000);
});

test('the oldest photo of a check-in goes first; a later one waits for it', () => {
  const items = [item({ id: 'a2', kind: 'AFTER', createdAt: 2000 }), item({ id: 'b1', kind: 'BEFORE', createdAt: 1000 })];
  assert.equal(nextToSend(items, 5000)!.id, 'b1');
  assert.equal(nextToSend([items[0]], 5000)!.id, 'a2');   // once the before photo is gone
});

test('a refused photo holds back the rest of its check-in but not other check-ins', () => {
  const items = [
    item({ id: 'b1', checkinId: 'c1', createdAt: 1000, state: 'FAILED', error: 'x', nextAt: Number.MAX_SAFE_INTEGER }),
    item({ id: 'a1', checkinId: 'c1', kind: 'AFTER', createdAt: 1500 }),
    item({ id: 'b2', checkinId: 'c2', createdAt: 2000 }),
  ];
  assert.equal(nextToSend(items, 9000)!.id, 'b2');
  assert.equal(nextToSend(items.slice(0, 2), 9000), null);
});

test('a photo is not retried before its time; across check-ins the oldest ready one goes', () => {
  const items = [item({ id: 'x', checkinId: 'c1', createdAt: 1000, nextAt: 8000 }), item({ id: 'y', checkinId: 'c2', createdAt: 2000, nextAt: 0 })];
  assert.equal(nextToSend(items, 5000)!.id, 'y');
  assert.equal(nextToSend(items, 8000)!.id, 'x');
  assert.equal(nextToSend([], 1), null);
});

test('queued photos count toward the maximum and block sending the check-in', () => {
  const items = [item({ id: '1' }), item({ id: '2', kind: 'AFTER' }), item({ id: '3', checkinId: 'c2' })];
  assert.equal(queuedCount(items, 'c1'), 2); assert.equal(queuedCount(items, 'c1', 'BEFORE'), 1); assert.equal(queuedCount(items, 'c2', 'AFTER'), 0);
  assert.equal(blocksSubmit(items, 'c1'), true); assert.equal(blocksSubmit(items, 'c9'), false);
  assert.deepEqual(summarize([...items, item({ id: '4', state: 'FAILED' })]), { waiting: 3, failed: 1 });
});

test('after a try: a refusal becomes final; no answer keeps the photo and remembers it may have arrived; an answer clears that', () => {
  const failed = afterAttempt(item({ attempts: 1, maybeSent: true }), 'FAILED', 'ditolak', 100, true);
  assert.deepEqual([failed.state, failed.attempts, failed.maybeSent, failed.error], ['FAILED', 2, false, 'ditolak']);
  const lost = afterAttempt(item({ attempts: 0 }), 'RETRY', 'tidak ada sinyal', 100, false);
  assert.deepEqual([lost.state, lost.attempts, lost.maybeSent, lost.nextAt], ['PENDING', 1, true, 100 + 10_000]);
  const answered = afterAttempt(item({ attempts: 2, maybeSent: true }), 'RETRY', 'server sibuk', 100, true);
  assert.deepEqual([answered.maybeSent, answered.nextAt], [false, 100 + 40_000]);
});

test('the banner says why a waiting photo has not gone and never promises to resend a refused one', () => {
  const src = readFileSync('app/ckb/housekeeping/upload-queue.tsx', 'utf8');
  assert.ok(src.includes('reasons') && src.includes('i.state === "PENDING" && i.error'), 'the reason of a waiting photo is not shown');
  assert.ok(/s\.waiting > 0\s*\?\s*<p/.test(src), 'the "sent automatically" line must only show while something waits');
});

test('a check-in in progress opens by itself, and the sticky Kirim bar clears the phone bottom bar', () => {
  assert.ok(readFileSync('app/ckb/housekeeping/tabs/today-tab.tsx', 'utf8').includes('useState(r.state === "STARTED")'));
  assert.ok(readFileSync('app/ckb/housekeeping/photo-slot.tsx', 'utf8').includes('sticky bottom-[4.5rem]'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
