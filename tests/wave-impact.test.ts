/**
 * "This will affect…" (lib/wave-impact.ts): the database's stok kurang and
 * Tunggu relokasi rules replayed before and after an action; only rows of other
 * waves that get worse are reported. Cases from 5 Oct.
 */
import { strict as assert } from 'node:assert';
import { impactOf, states, type ImpStock, type ImpTask } from '../lib/wave-impact';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const S = '550058592', B = '05H26JJ', E = '2030-08-05';
const st = (bin: string, qty: number): ImpStock => ({ bin, sku: S, batch: B, expiry: E, qty });
const tk = (id: string, wave: string, type: 'PICK' | 'REPLENISH', from: string, qty: number, to: string | null = null): ImpTask =>
  ({ id, label: `NO ${wave} ${id}`, wave, parked: false, type, sku: S, from, to, batch: B, expiry: E, qty });

console.log('\nThis will affect…');

// 5 Oct: NO 1 opens pallet CE28D02 (pick 10, rest 34 -> CE30A02); NO 3 and NO 6 pick from the pickface CE30A02.
const stock = [st('CE28D02', 44)];
const tasks = [tk('n1p', '1', 'PICK', 'CE28D02', 10), tk('n1m', '1', 'REPLENISH', 'CE28D02', 34, 'CE30A02'),
  tk('n3', '3', 'PICK', 'CE30A02', 7), tk('n6', '6', 'PICK', 'CE30A02', 15)];

test('the rules match the database: rows on an empty pickface wait for the move into it', () => {
  const s = states(stock, tasks);
  assert.deepEqual([s.get('n1p'), s.get('n1m'), s.get('n3'), s.get('n6')], ['ok', 'ok', 'waiting', 'waiting']);
});

test('Tunda NO 1: NO 3 and NO 6 are held by its Bin To Bin, NO 1 itself is not listed', () => {
  const imp = impactOf(stock, tasks, { kind: 'park', wave: '1' }, []);
  assert.deepEqual(imp.map((i) => [i.id, i.after]).sort(), [['n3', 'held'], ['n6', 'held']]);
});

test('Posting Bin To Bin saja on NO 1: nobody gets worse (the waiting rows are freed)', () => {
  assert.deepEqual(impactOf(stock, tasks, { kind: 'postMove', moveId: 'n1m' }, ['n1m']), []);
  const after = states([st('CE28D02', 10), st('CE30A02', 34)], tasks.filter((t) => t.id !== 'n1m'));
  assert.equal(after.get('n3'), 'ok');
});

test('Ubah baris NO 6 back onto CE28D02 (15): it takes what NO 1 needs → NO 1 becomes stok kurang', () => {
  const posted = [st('CE28D02', 10), st('CE30A02', 34)];
  const open = [tk('n1p', '1', 'PICK', 'CE28D02', 10), tk('n6', '6', 'PICK', 'CE30A02', 15)];
  const imp = impactOf(posted, open, { kind: 'replace', remove: ['n6'], add: [tk('n6', '6', 'PICK', 'CE28D02', 15)] }, ['n6']);
  assert.deepEqual(imp.map((i) => [i.id, i.after]), [['n1p', 'short']]);
});

test('undoing a posted move whose rest others still pick from: they must wait again', () => {
  const posted = [st('CE28D02', 10), st('CE30A02', 34)];
  const open = [tk('n6', '6', 'PICK', 'CE30A02', 15)];
  const imp = impactOf(posted, open, { kind: 'unpost', tasks: [tk('n1m', '1', 'REPLENISH', 'CE28D02', 34, 'CE30A02')] }, ['n1m']);
  assert.deepEqual(imp.map((i) => [i.id, i.after]), [['n6', 'waiting']]);
});

test('undoing a pick only: its cartons come back and its row reopens, nobody else changes', () => {
  const imp = impactOf([st('CE28D02', 0)], [], { kind: 'unpost', tasks: [tk('n1p', '1', 'PICK', 'CE28D02', 10)] }, ['n1p']);
  assert.deepEqual(imp, []);
});

test('rows already in trouble before the action are not reported again', () => {
  const s = [st('CE28D02', 5)];
  const open = [tk('a', '2', 'PICK', 'CE28D02', 10)];
  const imp = impactOf(s, open, { kind: 'replace', remove: [], add: [tk('b', '3', 'PICK', 'CE28D02', 1)] }, ['b']);
  assert.deepEqual(imp, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
