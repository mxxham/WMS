/**
 * Perbaiki (lib/wave-fix.ts): the proposal for a stok kurang row, on the four
 * rows fixed by hand on 5 Oct. Guards: never takes stock another open row
 * needs, keeps FEFO (flags a later expiry), uses the engine's bin choice,
 * shrinks a Bin To Bin to what is really left, says so when nothing covers.
 */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { planFixes, proposeFix, type FixClaim, type FixStock } from '../lib/wave-fix';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const config = withConfig({ asOf: new Date('2026-10-05T00:00:00Z') });
const st = (bin: string, batch: string, expiry: string, qty: number, blocked = false): FixStock => ({ bin, batch, expiry, qty, blocked });

console.log('\nPerbaiki');

test('NO 1 #5 (5 Oct): CE28D02 44, NO 6 takes 15 → keep the bin, Bin To Bin 34 → 19', () => {
  const claims: FixClaim[] = [{ from: 'CE28D02', to: null, batch: '05H26JJ', expiry: '2030-08-05', qty: 15 }];
  const p = proposeFix({ from: 'CE28D02', sku: '550058592', batch: '05H26JJ', expiry: '2030-08-05', qty: 10, upp: 44 },
    { to: 'CE30A02', qty: 34 }, [st('CE28D02', '05H26JJ', '2030-08-05', 44)], claims, config);
  assert.equal(p.kind, 'resize');
  if (p.kind !== 'resize') return;
  assert.deepEqual([p.from, p.moveTo, p.moveQty], ['CE28D02', 'CE30A02', 19]);
  assert.match(p.sentence, /jadi 19 \(bukan 34\)/);
});

test('nothing left after the pick → the Bin To Bin is dropped, the pick stays', () => {
  const p = proposeFix({ from: 'CE28D02', sku: 'S', batch: 'B', expiry: '2030-08-05', qty: 10, upp: 44 },
    { to: 'CE30A02', qty: 34 }, [st('CE28D02', 'B', '2030-08-05', 10)], [], config);
  assert.equal(p.kind, 'resize');
  if (p.kind === 'resize') assert.deepEqual([p.moveTo, p.moveQty], [null, null]);
});

test('NO 1 #1 (5 Oct): CF40C01 emptied into CF39A02 → pick from CF39A02, same batch, no move', () => {
  const p = proposeFix({ from: 'CF40C01', sku: '550044709', batch: '14I26JJ', expiry: '2030-09-14', qty: 2, upp: 48 }, null,
    [st('CF39A02', '14I26JJ', '2030-09-14', 33), st('CF04D01', '14I26JJ', '2030-09-14', 48)], [], config);
  assert.equal(p.kind, 'repoint');
  if (p.kind !== 'repoint') return;
  assert.deepEqual([p.from, p.batch, p.expiry, p.moveTo, p.fefoLater], ['CF39A02', '14I26JJ', '2030-09-14', null, false]);
  // The engine's rule: the open rest (33) is used before a sealed pallet (48) is broken for 2 cartons.
});

test('NO 5 #2 (5 Oct): CC25A02 empty → CE10A02, the rest of pallet CE08C01', () => {
  const p = proposeFix({ from: 'CC25A02', sku: '550058593', batch: '08H26JJ', expiry: '2030-08-08', qty: 4, upp: 48 }, null,
    [st('CE10A02', '08H26JJ', '2030-08-08', 30)], [], config);
  assert.equal(p.kind, 'repoint');
  if (p.kind === 'repoint') assert.equal(p.from, 'CE10A02');
});

test('stock another open row needs is never taken', () => {
  const claims: FixClaim[] = [{ from: 'CE10A02', to: null, batch: '08H26JJ', expiry: '2030-08-08', qty: 28 }];
  const p = proposeFix({ from: 'CC25A02', sku: 'S', batch: '08H26JJ', expiry: '2030-08-08', qty: 4, upp: 48 }, null,
    [st('CE10A02', '08H26JJ', '2030-08-08', 30), st('CE11A01', '08H26JJ', '2030-08-08', 9)], claims, config);
  assert.equal(p.kind, 'repoint');
  if (p.kind === 'repoint') assert.equal(p.from, 'CE11A01', 'CE10A02 has only 2 free');
});

test('cartons an open Bin To Bin will carry out are not free; a bin with only incoming stock is not offered', () => {
  const claims: FixClaim[] = [{ from: 'CE08C01', to: 'CE10A02', batch: 'B', expiry: '2030-08-08', qty: 30 }];
  const p = proposeFix({ from: 'CA01A01', sku: 'S', batch: 'B', expiry: '2030-08-08', qty: 4, upp: 48 }, null,
    [st('CE08C01', 'B', '2030-08-08', 48)], claims, config);
  // CE08C01: 48 − 30 leaving = 18 free, covers 4. CE10A02 has nothing on the shelf yet, so it is not proposed.
  assert.equal(p.kind === 'repoint' && p.from, 'CE08C01');
  assert.match(p.sentence, /bebas 18/);
});

test('FEFO: the earliest expiry wins; a later one only when nothing earlier covers it, and it is flagged', () => {
  const early = proposeFix({ from: 'CA01A01', sku: 'S', batch: 'B1', expiry: '2030-01-01', qty: 5, upp: 48 }, null,
    [st('CB01A01', 'B2', '2030-02-01', 40), st('CC01A01', 'B0', '2029-12-01', 20)], [], config);
  assert.equal(early.kind === 'repoint' && early.from, 'CC01A01');
  assert.equal(early.kind === 'repoint' && early.fefoLater, false);
  const later = proposeFix({ from: 'CA01A01', sku: 'S', batch: 'B1', expiry: '2030-01-01', qty: 5, upp: 48 }, null,
    [st('CB01A01', 'B2', '2030-02-01', 40)], [], config);
  assert.equal(later.kind === 'repoint' && later.fefoLater, true);
  assert.match(later.sentence, /FEFO dilewati/);
});

test('blocked bins, pillars and aisle CG are never proposed', () => {
  const p = proposeFix({ from: 'CA01A01', sku: 'S', batch: 'B', expiry: '2030-01-01', qty: 5, upp: 48 }, null,
    [st('CB01A01', 'B', '2030-01-01', 40, true), st('CE33A01', 'B', '2030-01-01', 40), st('CG01A01', 'B', '2030-01-01', 40)], [], config);
  assert.equal(p.kind, 'none');
});

test('opening a sealed pallet keeps the old Bin To Bin destination for its rest', () => {
  const p = proposeFix({ from: 'CA01A01', sku: 'S', batch: 'B', expiry: '2030-01-01', qty: 10, upp: 48 }, { to: 'CB10A01', qty: 30 },
    [st('CD05C01', 'B', '2030-01-01', 48)], [], config);
  assert.equal(p.kind, 'repoint');
  if (p.kind === 'repoint') assert.deepEqual([p.from, p.moveTo, p.moveQty], ['CD05C01', 'CB10A01', 38]);
});

test('no bin covers it → says so (Pecah / Batal), changes nothing', () => {
  const p = proposeFix({ from: 'CA01A01', sku: 'S', batch: 'B', expiry: '2030-01-01', qty: 50, upp: 48 }, null,
    [st('CB01A01', 'B', '2030-01-01', 30), st('CB02A01', 'B', '2030-01-01', 30)], [], config);
  assert.equal(p.kind, 'none');
  assert.match(p.sentence, /Pecah/);
});

test('the bin already covers everything → nothing to change', () => {
  const p = proposeFix({ from: 'CA01A01', sku: 'S', batch: 'B', expiry: '2030-01-01', qty: 5, upp: 48 }, null,
    [st('CA01A01', 'B', '2030-01-01', 30)], [], config);
  assert.equal(p.kind, 'ok');
});


test('Perbaiki semua: two short rows never get the same free cartons', () => {
  // CE10A02 has 6 free; two rows need 4 each. The first takes CE10A02, the second must go elsewhere.
  const stock = [st('CE10A02', 'B', '2030-08-08', 6), st('CE11A01', 'B', '2030-08-08', 9)];
  const open = [
    { id: 'r1', from: 'CC25A02', to: null, batch: 'B', expiry: '2030-08-08', qty: 4 },
    { id: 'r2', from: 'CC25A03', to: null, batch: 'B', expiry: '2030-08-08', qty: 4 },
  ];
  const row = (id: string, from: string) => ({ pickId: id, moveId: null, move: null, row: { from, sku: 'S', batch: 'B', expiry: '2030-08-08', qty: 4, upp: 48 } });
  const plan = planFixes([row('r1', 'CC25A02'), row('r2', 'CC25A03')], stock, open, config);
  const froms = plan.map((p) => (p.proposal.kind === 'repoint' ? p.proposal.from : p.proposal.kind));
  assert.equal(new Set(froms).size, 2, `both rows got ${froms.join(', ')}`);
  assert.ok(froms.includes('CE10A02') && froms.includes('CE11A01'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
