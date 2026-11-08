/** Auto putaway: pallets per SKU and the bin for each (lib/inbound/putaway-plan.ts). */
import { strict as assert } from 'node:assert';
import { packOf, planPutaway, type PutawayLine } from '../lib/inbound/putaway-plan';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nAuto putaway');

// Empty rack bins: aisles CA and CB, racks 01..05, levels A..E, position 01.
const bins: string[] = [];
for (const a of ['CA', 'CB']) for (let r = 1; r <= 5; r++) for (const l of 'ABCDE') bins.push(`${a}${String(r).padStart(2, '0')}${l}01`);
const line = (o: Partial<PutawayLine>): PutawayLine => ({ line: 1, sku: '550070614', uom: 'CAR', description: 'Hlx_4*4L', quantity: 72, upp: 36, ...o });
const levelOf = (b: string | null) => b?.[4];
const rackOf = (b: string | null) => b?.slice(0, 4);

test('packaging: master list first, then UoM / description', () => {
  assert.equal(packOf('550070614', 'CAR', ''), 'Carton');
  assert.equal(packOf('550024919', 'EA', ''), 'Drum', 'master list');
  assert.equal(packOf('550099999', 'EA', 'RimR4X15W40CI4E7DH1_1*209L_A227'), 'Drum', '209 L is a drum');
  assert.equal(packOf('550099999', 'EA', 'Gadus S3 V220C 3_1*18kg_A227'), 'Pail');
  assert.equal(packOf('550099999', 'EA', 'Something_1*1000L_IBC'), 'IBC');
  assert.equal(packOf('550099999', 'EA', 'Something odd'), null, 'unknown: no automatic bin');
});

test('720 cartons at 36 per pallet: 20 full pallets, each in its own empty bin', () => {
  const r = planPutaway({ lines: [line({ quantity: 720 })], emptyBins: bins, pickfaces: new Map() });
  assert.equal(r.pallets.length, 20);
  assert.ok(r.pallets.every((p) => p.full && p.quantity === 36));
  assert.equal(new Set(r.pallets.map((p) => p.bin)).size, 20);
});

test('the rest below a full pallet goes to the pickface (level A)', () => {
  const r = planPutaway({ lines: [line({ quantity: 80 })], emptyBins: bins, pickfaces: new Map([['550070614', 'CB03A01']]) });
  assert.deepEqual(r.pallets.map((p) => [p.quantity, p.full, p.bin]), [[36, true, r.pallets[0].bin], [36, true, r.pallets[1].bin], [8, false, 'CB03A01']]);
});

test('full pallets prefer the pickface aisle, nearest rack, levels B..E before A', () => {
  const r = planPutaway({ lines: [line({ quantity: 36 })], emptyBins: bins, pickfaces: new Map([['550070614', 'CB03A01']]) });
  assert.equal(r.pallets[0].bin, 'CB03B01');
});

test('a pickface bin is never used for a full pallet', () => {
  const r = planPutaway({ lines: [line({ quantity: 36 })], emptyBins: ['CB03B01', 'CA01B01'], pickfaces: new Map([['550070614', 'CB03A01'], ['550000002', 'CB03B01']]) });
  assert.equal(r.pallets[0].bin, 'CA01B01');
});

test('drums never above C, pails only A, fluidbag and IBC only B', () => {
  const plan = (sku: string, description: string, qty: number, upp: number) =>
    planPutaway({ lines: [line({ sku, uom: 'EA', description, quantity: qty, upp })], emptyBins: bins, pickfaces: new Map() }).pallets;
  assert.ok(plan('550099991', 'X_1*209L', 4 * 30, 4).every((p) => p.bin === null || 'BC'.includes(levelOf(p.bin)!)), 'drum: B-C');
  assert.ok(plan('550099992', 'X_1*18kg', 40 * 5, 40).every((p) => levelOf(p.bin) === 'A'), 'pail');
  assert.ok(plan('550099993', 'X_1*1000L_IBC', 3, 1).every((p) => 'AB'.includes(levelOf(p.bin)!)), 'IBC: A or B');
});

test('an IBC / fluidbag leftover goes to its pickface (level A) like any leftover', () => {
  const r = planPutaway({ lines: [line({ sku: '550099993', uom: 'EA', description: 'X_1*1000L_IBC', quantity: 1, upp: 2 })],
    emptyBins: bins, pickfaces: new Map([['550099993', 'CA01A01']]) });
  assert.equal(r.pallets[0].bin, 'CA01A01');
});

test('550062285 (Gadus 770 kg, fluidbag, 1 per pallet): full pallets may use level A as well as B', () => {
  const r = planPutaway({ lines: [line({ sku: '550062285', uom: 'EA', description: 'Gadus S3 V460DM 2_1*770kg_A227', quantity: 3, upp: 1 })],
    emptyBins: ['CC05A01', 'CC05A02', 'CC05B01', 'CC05C01', 'CC05D01'], pickfaces: new Map() });
  assert.deepEqual(r.pallets.map((p) => p.bin), ['CC05B01', 'CC05A01', 'CC05A02'], 'B first, then A; never C-E');
});

test('no pickface: the leftover goes to an empty level-A bin (not by name: CA01 is not the default)', () => {
  const r = planPutaway({ lines: [line({ quantity: 10 })], emptyBins: bins, pickfaces: new Map() });
  assert.equal(levelOf(r.pallets[0].bin), 'A');
  const starts = new Set(['550000001', '550000002', '550000003', '550000004', '550000005', '550000006'].map((sku) =>
    rackOf(planPutaway({ lines: [line({ sku, quantity: 10 })], emptyBins: bins, pickfaces: new Map() }).pallets[0].bin)));
  assert.ok(starts.size > 1, 'equal racks: different SKUs start in different racks');
});

test('no free bin left: the pallet has no bin and says why', () => {
  const r = planPutaway({ lines: [line({ quantity: 108 })], emptyBins: ['CA01B01', 'CA01C01'], pickfaces: new Map() });
  assert.deepEqual(r.pallets.map((p) => p.bin), ['CA01B01', 'CA01C01', null]);
  assert.match(r.pallets[2].why ?? '', /Tidak ada bin kosong/);
});

test('no units per pallet: one pallet with a warning', () => {
  const r = planPutaway({ lines: [line({ quantity: 50, upp: null })], emptyBins: bins, pickfaces: new Map() });
  assert.equal(r.pallets.length, 1);
  assert.match(r.warnings.join(' '), /UPP/);
});

test('unknown packaging: no automatic bin', () => {
  const r = planPutaway({ lines: [line({ sku: '550099999', uom: 'EA', description: 'odd', quantity: 5, upp: 4 })], emptyBins: bins, pickfaces: new Map() });
  assert.ok(r.pallets.every((p) => p.bin === null && /kemasan/.test(p.why ?? '')));
});

test('two lines never get the same bin', () => {
  const r = planPutaway({ lines: [line({ quantity: 72 }), line({ line: 2, sku: '550038021', quantity: 72 })], emptyBins: bins, pickfaces: new Map() });
  const used = r.pallets.map((p) => p.bin);
  assert.equal(new Set(used).size, used.length);
});

test('level A is only for leftovers: a full carton or drum pallet never goes to A, even when A is the only free bin', () => {
  const onlyA = ['CE20A01', 'CE20A02', 'CE18A01'];
  const carton = planPutaway({ lines: [line({ quantity: 36 * 2 })], emptyBins: onlyA, pickfaces: new Map() });
  assert.ok(carton.pallets.every((p) => p.bin === null), 'no level-A bin for a full carton pallet');
  const drum = planPutaway({ lines: [line({ sku: '550044360', uom: 'EA', description: 'RimR4X15W40CI4E7DH1_1*209L_A227', quantity: 8, upp: 4 })],
    emptyBins: [...onlyA, 'CE20B01', 'CE20D01'], pickfaces: new Map() });
  assert.deepEqual(drum.pallets.map((p) => p.bin), ['CE20B01', null], 'drum full pallets: B or C only');
});

test('the 29 Oct case: full pallets of 550038021 use B..E, only the 4-carton leftover uses A', () => {
  const free = ['CE20D01', 'CE20D02', 'CE20E01', 'CE20E02', 'CE20A01', 'CE20A02', 'CE19D01', 'CE19D02', 'CE18A01', 'CE22A01', 'CE16D01', 'CE16D02'];
  const r = planPutaway({ lines: [line({ sku: '550038021', quantity: 400 })], emptyBins: free, pickfaces: new Map() });
  const full = r.pallets.filter((p) => p.full), rest = r.pallets.filter((p) => !p.full);
  assert.ok(full.every((p) => p.bin === null || 'BCDE'.includes(p.bin[4])), full.map((p) => p.bin).join(','));
  assert.equal(rest[0].bin![4], 'A');
});

test('no favourite rack: without a pickface the SKU starts in the rack with the most free room, not CA01', () => {
  // CA01 has 1 free bin, CC07 has 8 (levels B..E, positions 01 and 02)
  const free = ['CA01B01', ...'BCDE'.split('').flatMap((l) => [`CC07${l}01`, `CC07${l}02`])];
  const r = planPutaway({ lines: [line({ quantity: 36 * 3 })], emptyBins: free, pickfaces: new Map() });
  assert.deepEqual(r.pallets.map((p) => rackOf(p.bin)), ['CC07', 'CC07', 'CC07']);
});

test('grouping: a SKU fills every free bin of its rack before the next rack', () => {
  const free = [...'BCDE'.split('').flatMap((l) => [`CB01${l}01`, `CB01${l}02`]), ...'BCDE'.split('').map((l) => `CB02${l}01`), 'CB09B01'];
  const r = planPutaway({ lines: [line({ quantity: 36 * 10 })], emptyBins: free, pickfaces: new Map() });
  const racks = r.pallets.map((p) => rackOf(p.bin));
  assert.deepEqual(racks.slice(0, 8), Array(8).fill('CB01'), 'all 8 bins of CB01 first');
  assert.deepEqual(racks.slice(8), ['CB02', 'CB02'], 'then the nearest rack, CB02, not CB09');
});

test('grouping with a pickface: start in the rack nearest the pickface, fill it, then the next nearest', () => {
  const free = [...'BCDE'.split('').map((l) => `CB05${l}01`), ...'BCDE'.split('').map((l) => `CB03${l}01`), 'CA01B01'];
  const r = planPutaway({ lines: [line({ quantity: 36 * 6 })], emptyBins: free, pickfaces: new Map([['550070614', 'CB04A01']]) });
  const racks = r.pallets.map((p) => rackOf(p.bin));
  assert.equal(new Set(racks.slice(0, 4)).size, 1, 'the first four pallets share one rack');
  assert.ok(['CB03', 'CB05'].includes(racks[0]!));
  assert.deepEqual(new Set(racks.slice(4)).size, 1, 'the rest share the other nearby rack');
  assert.ok(!racks.includes('CA01'));
});

test('two SKUs do not both start in the same favourite rack when each fits its own', () => {
  const free = [...'BCDE'.split('').map((l) => `CA02${l}01`), ...'BCDE'.split('').map((l) => `CD10${l}01`)];
  const r = planPutaway({ lines: [line({ quantity: 36 * 4 }), line({ line: 2, sku: '550038021', quantity: 36 * 4 })], emptyBins: free, pickfaces: new Map() });
  const a = new Set(r.pallets.filter((p) => p.sku === '550070614').map((p) => rackOf(p.bin)));
  const b = new Set(r.pallets.filter((p) => p.sku === '550038021').map((p) => rackOf(p.bin)));
  assert.equal(a.size, 1); assert.equal(b.size, 1);
  assert.notDeepEqual([...a], [...b], 'each SKU gets a rack of its own');
});

test('spread over many sample layouts: the start rack follows free room, never one fixed rack', () => {
  const starts = new Set<string>();
  for (const big of ['CA05', 'CB11', 'CC17', 'CD23', 'CE30', 'CF02']) {
    const free = ['CA01B01', 'CA01C01', ...'BCDE'.split('').flatMap((l) => [`${big}${l}01`, `${big}${l}02`])];
    starts.add(rackOf(planPutaway({ lines: [line({ quantity: 36 })], emptyBins: free, pickfaces: new Map() }).pallets[0].bin)!);
  }
  assert.equal(starts.size, 6);
  assert.ok(!starts.has('CA01'));
});

// ---- Grouping by where the SKU already is ----------------------------------------------------------------
const rackBins = (rack: string, levels = 'BCDE', positions = ['01', '02']) => levels.split('').flatMap((l) => positions.map((p) => `${rack}${l}${p}`));

test('a SKU goes to the rack that already holds it, even when another rack has more room or is nearer its pickface', () => {
  const free = [...rackBins('CD08', 'CD', ['02']), ...rackBins('CB04'), ...rackBins('CA01')];
  const r = planPutaway({ lines: [line({ quantity: 36 * 2 })], emptyBins: free, pickfaces: new Map([['550070614', 'CB04A01']]),
    occupied: [{ bin: 'CD08B01', sku: '550070614' }, { bin: 'CD08C01', sku: '550070614' }] });
  assert.deepEqual(r.pallets.map((p) => rackOf(p.bin)), ['CD08', 'CD08']);
});

test('of two racks holding the SKU, the one holding most of it first', () => {
  const free = [...rackBins('CC02', 'E', ['02']), ...rackBins('CF30', 'E', ['02'])];
  const r = planPutaway({ lines: [line({ quantity: 36 })], emptyBins: free, pickfaces: new Map(),
    occupied: [{ bin: 'CC02B01', sku: '550070614' }, { bin: 'CF30B01', sku: '550070614' }, { bin: 'CF30C01', sku: '550070614' }] });
  assert.equal(rackOf(r.pallets[0].bin), 'CF30');
});

test('its rack full: the next rack is near its stock, and a rack with no other SKU beats a mixed one', () => {
  const free = [...rackBins('CC05', 'BC'), ...rackBins('CC06', 'BC'), ...rackBins('CC09', 'BC')];
  const r = planPutaway({ lines: [line({ quantity: 36 * 2 })], emptyBins: free, pickfaces: new Map(),
    occupied: [{ bin: 'CC04B01', sku: '550070614' }, { bin: 'CC05D01', sku: '550099001' }, { bin: 'CC06D01', sku: '550099002' }] });
  assert.deepEqual(r.pallets.map((p) => rackOf(p.bin)), ['CC09', 'CC09'], 'CC05 and CC06 are nearer but hold other SKUs');
});

test('only mixed racks left: the nearest one is used rather than no bin', () => {
  const free = [...rackBins('CC05', 'B'), ...rackBins('CC20', 'B')];
  const r = planPutaway({ lines: [line({ quantity: 36 })], emptyBins: free, pickfaces: new Map([['550070614', 'CC04A01']]),
    occupied: [{ bin: 'CC05D01', sku: '550099001' }, { bin: 'CC20D01', sku: '550099002' }] });
  assert.equal(rackOf(r.pallets[0].bin), 'CC05');
});

test('two SKUs of one receipt with neighbouring pickfaces get a rack each, not one shared rack', () => {
  const free = [...rackBins('CC03'), ...rackBins('CC04'), ...rackBins('CC02')];
  const r = planPutaway({ lines: [line({ quantity: 36 * 3 }), line({ line: 2, sku: '550038021', quantity: 36 * 3 })], emptyBins: free,
    pickfaces: new Map([['550070614', 'CC03A01'], ['550038021', 'CC03A02']]) });
  const a = new Set(r.pallets.filter((p) => p.sku === '550070614').map((p) => rackOf(p.bin)));
  const b = new Set(r.pallets.filter((p) => p.sku === '550038021').map((p) => rackOf(p.bin)));
  assert.deepEqual([...a], ['CC03']); assert.equal(b.size, 1); assert.ok(!b.has('CC03'));
});

test('bay 21 is behind bay 01: it counts as next to it, not 20 bays away', () => {
  const free = [...rackBins('CB21', 'B'), ...rackBins('CB05', 'B')];
  const r = planPutaway({ lines: [line({ quantity: 36 })], emptyBins: free, pickfaces: new Map([['550070614', 'CB01A01']]) });
  assert.equal(rackOf(r.pallets[0].bin), 'CB21');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
