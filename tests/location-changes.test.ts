// Perubahan lokasi (lib/location-changes.ts, 0130): action labels, Excel rows, per-bin summary.
import { strict as assert } from 'node:assert';
import {
  binSummaryRows, changeAction, changeSheetRows, changesFileName, jakartaTime, locationText, sortChanges, type LocationChange,
} from '../lib/location-changes';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

let nextId = 1;
const ch = (o: Partial<LocationChange>): LocationChange => ({
  id: nextId++, task_id: 't1', planned_date: '2026-12-05', wave_no: '1', shipment_number: 'S1', task_type: 'PICK',
  sku: '550058593', description: 'HELIX', quantity: 12, original_bin: 'CC27D02',
  old_bin: 'CC27D02', new_bin: 'CE10A02', old_batch: 'A', new_batch: 'A', old_expiry: '2030-09-10', new_expiry: '2030-09-10',
  old_to_bin: null, new_to_bin: null, kind: 'PLAN', source: 'TRIGGER', reason: null, changed_by_name: 'Sup',
  changed_at: '2026-12-05T01:30:00Z', fefo_skipped: false, via_audit: false, wave_status: 'PENDING', ...o,
});

test('each logged sentence names its action', () => {
  assert.equal(changeAction(ch({ reason: 'baris diubah oleh Sup: sumber ...' })), 'UBAH_BARIS');
  assert.equal(changeAction(ch({ reason: 'bin pick diubah oleh Sup: CC27D02 → CE10A02' })), 'UBAH_BIN');
  assert.equal(changeAction(ch({ reason: 'ikut Bin To Bin NO 1 #1: sisa 28 dari CC27D02 ke CE10A02, ...' })), 'PINDAH_SISA');
  assert.equal(changeAction(ch({ reason: 'ikut palet: Bin To Bin NO 2 #3 ke CE10A02, bukan CC27D02; ...' })), 'IKUT_PALET');
  assert.equal(changeAction(ch({ reason: 'isi dari picklist oleh Sup: 28 CE10A02 -> 20 CE10A01' })), 'ISI_PICKLIST');
  assert.equal(changeAction(ch({ reason: null })), 'LAINNYA');
});

test('an actual-bin change is the picker, unless Audit picking made it', () => {
  assert.equal(changeAction(ch({ kind: 'ACTUAL', reason: 'diposting oleh Ani' })), 'DIPICK_LAIN');
  assert.equal(changeAction(ch({ kind: 'ACTUAL', reason: 'terima batch lain', via_audit: true })), 'AUDIT');
});

test('Excel row: original, before and after side by side, FEFO flagged, Jakarta time', () => {
  const [r] = changeSheetRows([ch({ old_bin: 'CE10A02', new_bin: 'CE11A01', new_batch: 'B', new_expiry: '2030-12-01',
    fefo_skipped: true, reason: 'baris diubah oleh Sup: x', changed_at: '2026-12-05T17:30:00Z' })]);
  assert.equal(r['Lokasi awal (rencana)'], 'CC27D02');
  assert.equal(r['Bin sebelum'], 'CE10A02');
  assert.equal(r['Bin sesudah'], 'CE11A01');
  assert.equal(r['Batch sesudah'], 'B');
  assert.equal(r['Exp sesudah'], '2030-12-01');
  assert.equal(r['FEFO dilewati'], 'YA');
  assert.equal(r['Aksi'], 'Ubah baris');
  // 17:30 UTC is 00:30 the next day in Jakarta, whatever the machine's timezone.
  assert.equal(r['Waktu'], '2026-12-06 00:30');
  assert.equal(r['Qty'], 12);
});

test('a change read back from Riwayat says so; a Bin To Bin shows its destination', () => {
  const [r] = changeSheetRows([ch({ source: 'LOG', task_type: 'REPLENISH', shipment_number: null, old_to_bin: 'CE10A02', new_to_bin: 'CE10A01' })]);
  assert.equal(r['Jenis'], 'Bin To Bin');
  assert.equal(r['Tujuan Bin To Bin sebelum'], 'CE10A02');
  assert.equal(r['Tujuan Bin To Bin sesudah'], 'CE10A01');
  assert.match(String(r['Sumber']), /Riwayat/);
});

test('rows print by date, then wave NO as a number, then time', () => {
  const rows = [
    ch({ planned_date: '2026-12-05', wave_no: '10', changed_at: '2026-12-05T01:00:00Z' }),
    ch({ planned_date: '2026-12-05', wave_no: '2', changed_at: '2026-12-05T03:00:00Z' }),
    ch({ planned_date: '2026-12-05', wave_no: '2', changed_at: '2026-12-05T02:00:00Z' }),
    ch({ planned_date: '2026-12-04', wave_no: '9', changed_at: '2026-12-04T02:00:00Z' }),
  ];
  assert.deepEqual(sortChanges(rows).map((r) => `${r.planned_date}/${r.wave_no}/${r.changed_at.slice(11, 13)}`),
    ['2026-12-04/9/02', '2026-12-05/2/02', '2026-12-05/2/03', '2026-12-05/10/01']);
});

test('per bin: moves away and onto each bin, quantities summed, batch-only changes ignored', () => {
  const out = binSummaryRows([
    ch({ old_bin: 'CC27D02', new_bin: 'CE10A02', quantity: 16 }),
    ch({ old_bin: 'CC27D02', new_bin: 'CE10A02', quantity: 12 }),
    ch({ old_bin: 'CE10A02', new_bin: 'CE11A01', quantity: 12 }),
    ch({ old_bin: 'CE11A01', new_bin: 'CE11A01', new_batch: 'B', quantity: 5 }),
  ]);
  const by = Object.fromEntries(out.map((r) => [r['Bin'], r]));
  assert.equal(out[0]['Bin'], 'CE10A02'); // three movements: two onto, one away
  assert.deepEqual([by.CC27D02['Dipindah dari bin ini'], by.CC27D02['Qty dari'], by.CC27D02['Dipindah ke bin ini']], [2, 28, 0]);
  assert.deepEqual([by.CE10A02['Dipindah ke bin ini'], by.CE10A02['Qty ke'], by.CE10A02['Dipindah dari bin ini']], [2, 28, 1]);
  assert.deepEqual([by.CE11A01['Dipindah ke bin ini'], by.CE11A01['Qty ke']], [1, 12]);
});

test('helpers: location cell and file name', () => {
  assert.equal(locationText('CC27D02', '', '2030-09-10'), 'CC27D02 · tanpa batch · 2030-09-10');
  assert.equal(changesFileName('2026-12-05', '2026-12-05', '3'), 'Perubahan lokasi 2026-12-05 NO 3.xlsx');
  assert.equal(changesFileName('2026-12-01', '2026-12-05', null), 'Perubahan lokasi 2026-12-01 sd 2026-12-05.xlsx');
  assert.equal(jakartaTime('not a date'), 'not a date');
});

console.log(`\nlocation-changes: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
