/** The Home page's module cards come from the same nav list as the sidebar: real routes, same roles. */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import type { Job } from '../lib/jobs';
import { SECTIONS, homePrimary, mobileLinksFor, sectionsFor } from '../components/app/nav-config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nHome page and nav list');

const hrefs = (job: Job) => sectionsFor(job).flatMap((s) => s.links.map((l) => l.href));

test('every module card is a real page', () => {
  for (const href of hrefs('admin')) assert.ok(existsSync(`app/(app)${href}/page.tsx`), `${href} has no page`);
});
test('operators see only their modules (no Dashboard, Alokasi, Import…)', () => {
  const op = hrefs('operator');
  assert.deepEqual(op, ['/scan', '/waves', '/inventory', '/warehouse']);
});
test('leaders get everything but Import and Pengaturan; admins get all', () => {
  const sup = hrefs('leader');
  assert.ok(sup.includes('/dashboard') && sup.includes('/allocate') && !sup.includes('/admin/import') && !sup.includes('/admin/settings'));
  assert.equal(hrefs('admin').length, sup.length + 3);
  assert.ok(hrefs('admin').includes('/admin/users') && !sup.includes('/admin/users'));
});
test('empty sections are dropped (operators have no Admin section)', () => {
  assert.ok(!sectionsFor('operator').some((s) => s.title === 'Admin'));
  assert.ok(sectionsFor('operator').every((s) => s.links.length > 0));
});
test('the phone bottom bar keeps its links', () => {
  assert.deepEqual(mobileLinksFor('leader').map((l) => l.href), ['/scan', '/waves', '/inventory', '/adjust', '/dashboard']);
  assert.deepEqual(mobileLinksFor('operator').map((l) => l.href), ['/scan', '/waves', '/inventory', '/warehouse']);
});
test('Home is not a nav item; the main button suits the role', () => {
  assert.ok(!hrefs('admin').includes('/home'));
  assert.deepEqual(homePrimary('leader'), { href: '/dashboard', label: 'Buka dashboard' });
  assert.deepEqual(homePrimary('admin'), { href: '/dashboard', label: 'Buka dashboard' });
  assert.deepEqual(homePrimary('operator'), { href: '/scan', label: 'Buka Scan' });
});

test('every module has a one-line description for the Home directory', () => {
  for (const sec of SECTIONS) for (const l of sec.links) {
    assert.ok(l.blurb.trim().length >= 10, `${l.href} has no description`);
    assert.ok(l.blurb.length <= 60, `${l.href}: description longer than one line (${l.blurb.length})`);
    assert.ok(/\.$/.test(l.blurb), `${l.href}: description ends without a full stop`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
