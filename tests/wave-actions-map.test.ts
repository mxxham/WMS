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
  // the old page showed Mulai picking on every running wave with lines, also when one was blocked
  { label: 'Mulai picking', file: 'wave-menu.tsx', host: 'wave-menu.tsx', uses: 'onStartPicking' },
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

// The phone layout (spec §2.3): every wave and line action through the same menus, Isi dari
// picklist nowhere.
test('phone: wave menu in its phone layout, without Isi dari picklist', () => {
  const screen = src('mobile/wave-screen.tsx');
  assert.match(screen, /<WaveMenu[^>]*layout="phone"/, 'wave-screen does not use WaveMenu layout="phone"');
  for (const f of ['mobile/phone-layout.tsx', 'mobile/day-screen.tsx', 'mobile/wave-screen.tsx']) {
    assert.ok(!src(f).includes('onOpenSheet') && !src(f).includes('Isi dari picklist'), `${f} reaches Isi dari picklist`);
  }
  assert.ok(src('wave-menu.tsx').includes('layout === "desktop"'), 'wave-menu does not gate Isi dari picklist on the desktop layout');
});
test('phone: lines use the same LineMenu and LinePrimary, panels the phone layout', () => {
  const screen = src('mobile/wave-screen.tsx');
  assert.ok(screen.includes('<LineMenu') && screen.includes('<LinePrimary'), 'wave-screen does not use LineMenu / LinePrimary');
  assert.ok(src('mobile/phone-layout.tsx').includes('m.panels("phone")'), 'phone-layout does not render the phone panels');
});

test('Buka lagi: the dialog reads the preview\'s blocked flag and turns the undo off', () => {
  const menu = src('wave-menu.tsx');
  assert.ok(/blocked: boolean/.test(menu) && menu.includes('b.blocked'), 'ReopenWaveButton ignores blocked');
});
test('Pulihkan wave: no replan from inside the restore dialog (it unmounts on refresh, and replans the whole day unconfirmed)', () => {
  assert.ok(!src('wave-menu.tsx').includes('replanRemaining'), 'wave-menu still calls replanRemaining');
});
test('both layouts hand WaveMenu a way to start picking', () => {
  assert.match(src('waves-client.tsx'), /<WaveMenu[^>]*onStartPicking=/, 'desktop WaveMenu has no onStartPicking');
  assert.match(src('mobile/wave-screen.tsx'), /<WaveMenu[^>]*onStartPicking=/, 'phone WaveMenu has no onStartPicking');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
