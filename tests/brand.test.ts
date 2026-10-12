/**
 * The app's name, logo and owner live in config/brand.ts only, so renaming the system or swapping the
 * logo is one edit; and the footer, Home page and pages read the same owner and year.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '../config/brand';
import { ABOUT } from '../components/app/about-copy';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nBrand and legal wording');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const source = ['app', 'components', 'lib'].flatMap(files);

test('the app name and logo file are written only in config/brand.ts', () => {
  const hits = source.filter((f) => { const s = readFileSync(f, 'utf8'); return s.includes('K-one') || s.includes('k-one-logo'); });
  assert.deepEqual(hits, [], `hardcoded name or logo in: ${hits.join(', ')}`);
});
test('the company name is written only in config/', () => {
  const hits = source.filter((f) => readFileSync(f, 'utf8').includes('Cipta Krida'));
  assert.deepEqual(hits, [], `hardcoded company in: ${hits.join(', ')}`);
});
test('the copyright line names the company and the year', () => {
  assert.equal(ABOUT.copyright, `© ${BRAND.year} ${BRAND.owner}`);
  assert.equal(BRAND.owner, 'PT Cipta Krida Bahari');
});
test('the LICENSE file states the same owner and year', () => {
  const lic = readFileSync('LICENSE', 'utf8');
  assert.ok(lic.includes(`${BRAND.year} ${BRAND.owner}`) && /all rights reserved/i.test(lic), 'LICENSE does not match config/brand.ts');
});
test('the footer links to Kredit, Lisensi and Privasi, and the pages exist', () => {
  const footer = readFileSync('components/app/site-footer.tsx', 'utf8');
  for (const s of ['openWelcome', '"/lisensi"', '"/privasi"', 'ABOUT.copyright', 'ABOUT.internal']) assert.ok(footer.includes(s), `footer lacks ${s}`);
  for (const p of ['app/(app)/lisensi/page.tsx', 'app/(app)/privasi/page.tsx']) assert.ok(statSync(p).isFile(), `${p} missing`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
