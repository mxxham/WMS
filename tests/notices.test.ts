/**
 * The Lisensi page lists every library the app ships, with its licence text. The list is generated
 * from node_modules (scripts/notices.mjs); this fails when it is stale, e.g. after adding a package.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nThird-party notices');

type Notice = { name: string; version: string; license: string; author: string | null; text: string | null };
const committed = JSON.parse(readFileSync('lib/third-party-notices.json', 'utf8')) as { packages: Notice[]; texts: Record<string, string> };
const fresh = JSON.parse(execFileSync('node', ['scripts/notices.mjs', '--stdout'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as { packages: Notice[] };

test('the committed list matches node_modules (run npm run notices if not)', () => {
  assert.deepEqual(committed.packages.map((p) => `${p.name}@${p.version}`), fresh.packages.map((p) => `${p.name}@${p.version}`));
});
test('every package with a licence file points at its text, published as public/licenses/<id>.txt', () => {
  for (const p of committed.packages) if (p.text) {
    assert.ok(committed.texts[p.text], `${p.name}: text ${p.text} missing`);
    assert.equal(readFileSync(`public/licenses/${p.text}.txt`, 'utf8'), committed.texts[p.text] + '\n', `${p.name}: public/licenses/${p.text}.txt stale`);
  }
});
test('every direct dependency is listed', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
  const names = new Set(committed.packages.map((p) => p.name));
  for (const d of Object.keys(pkg.dependencies)) assert.ok(names.has(d), `${d} missing`);
});
test('the fonts carry the full OFL text, and only permissive or OFL licences ship', () => {
  const font = committed.packages.find((p) => p.name === '@fontsource/ibm-plex-sans')!;
  assert.match(committed.texts[font.text ?? ''] ?? '', /SIL OPEN FONT LICENSE/i);
  const ok = /^(\(?(MIT|ISC|Apache-2\.0|BSD-[23]-Clause|0BSD|OFL-1\.1|Unlicense|MIT\/X11|Zlib|CC-BY-4\.0)( (OR|AND) |\)?$))+/;
  for (const p of committed.packages) {
    if (p.license === 'UNKNOWN') continue;
    assert.match(p.license, ok, `${p.name}: ${p.license}`);
  }
});
test('jszip is used under MIT (it offers MIT or GPL-3.0)', () => {
  assert.equal(committed.packages.find((p) => p.name === 'jszip')?.license, 'MIT');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
