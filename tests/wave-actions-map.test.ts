/**
 * The Wave page redesign moves buttons, never removes them. For every action the old page showed,
 * this checks that its label is still rendered by the component that now owns it, and that the
 * menu (or layout) that hosts it actually uses that component.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nWave page: every old action still has a home');

const src = (f: string) => readFileSync(`app/(app)/waves/${f}`, 'utf8');
/** label → the file that renders it → the host that must use that file's component (name). */
type Home = { label: string; file: string; host: string; uses: string };
const homes: Home[] = [
  // wave level
  { label: 'Picklist', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'WaveMenu' },
  { label: 'Isi dari picklist', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'canSheet' },
  { label: 'Tambah item', file: 'add-order.tsx', host: 'wave-menu.tsx', uses: 'AddItems' },
  { label: 'Selesaikan wave', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'CompleteWaveButton' },
  { label: 'Tutup wave', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'CompleteWaveButton' },
  { label: 'Tunda', file: 'wave-parts.tsx', host: 'wave-menu.tsx', uses: 'TundaButton' },
  { label: 'Aktifkan', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'Aktifkan' },
  { label: 'Batalkan wave', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'MenuDanger' },
  { label: 'Buka lagi', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'ReopenWaveButton' },
  { label: 'Pulihkan wave', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'RestoreWaveButton' },
  // line level
  { label: 'Posting', file: 'task-post-dialog.tsx', host: 'line-menu.tsx', uses: 'TaskPostDialog' },
  { label: 'Posting', file: 'pair-post-dialog.tsx', host: 'line-menu.tsx', uses: 'PairPostDialog' },
  { label: 'Berbeda', file: 'task-post-dialog.tsx', host: 'line-menu.tsx', uses: 'TaskPostDialog' },
  { label: 'Posting sesuai lapangan', file: 'wave-corrections.tsx', host: 'line-menu.tsx', uses: 'EditRowButton' },
  { label: 'Ubah baris', file: 'wave-corrections.tsx', host: 'line-menu.tsx', uses: 'EditRowButton' },
  { label: 'Pecah', file: 'wave-corrections.tsx', host: 'line-menu.tsx', uses: 'SplitButton' },
  { label: 'Posting Bin To Bin saja', file: 'line-menu.tsx', host: 'line-menu.tsx', uses: 'PostMoveEarlyButton' },
  { label: 'Perbaiki', file: 'wave-corrections.tsx', host: 'line-menu.tsx', uses: 'FixButton' },
  { label: 'Riwayat', file: 'row-history.tsx', host: 'line-menu.tsx', uses: 'RowHistory' },
  { label: 'Batalkan posting', file: 'wave-corrections.tsx', host: 'line-menu.tsx', uses: 'UnpostButton' },
  { label: 'Batalkan posting', file: 'wave-corrections.tsx', host: 'line-menu.tsx', uses: 'UnpostPairButton' },
  { label: 'Tambah Bin To Bin', file: 'wave-corrections.tsx', host: 'line-menu.tsx', uses: 'AddMoveButton' },
  { label: 'Batal', file: 'wave-parts.tsx', host: 'line-menu.tsx', uses: 'CancelButton' },
  { label: 'Pulihkan', file: 'line-menu.tsx', host: 'line-menu.tsx', uses: 'set_task_status' },
];

for (const h of homes) {
  test(`${h.label}: rendered by ${h.file}, used by ${h.host} (${h.uses})`, () => {
    assert.ok(src(h.file).includes(h.label), `"${h.label}" not found in ${h.file}`);
    assert.ok(src(h.host).includes(h.uses), `${h.host} does not use ${h.uses}`);
  });
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
