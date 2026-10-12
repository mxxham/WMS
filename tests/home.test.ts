/** The Home page's module cards come from the same nav list as the sidebar: real routes, same roles. */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { homePrimary, mobileLinksFor, sectionsFor } from '../components/app/nav-config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nHome page and nav list');

const hrefs = (role: 'operator' | 'supervisor' | 'admin') => sectionsFor(role).flatMap((s) => s.links.map((l) => l.href));

test('every module card is a real page', () => {
  for (const href of hrefs('admin')) assert.ok(existsSync(`app/(app)${href}/page.tsx`), `${href} has no page`);
});
test('operators see only their modules (no Dashboard, Alokasi, Import…)', () => {
  const op = hrefs('operator');
  assert.deepEqual(op, ['/scan', '/receiving', '/waves', '/inventory', '/warehouse', '/counts', '/audit/picking', '/audit/putaway']);
});
test('supervisors get everything but Import and Pengaturan; admins get all', () => {
  const sup = hrefs('supervisor');
  assert.ok(sup.includes('/dashboard') && sup.includes('/allocate') && !sup.includes('/admin/import') && !sup.includes('/admin/settings'));
  assert.equal(hrefs('admin').length, sup.length + 3);
  assert.ok(hrefs('admin').includes('/admin/users') && !sup.includes('/admin/users'));
});
test('empty sections are dropped (operators have no Admin section)', () => {
  assert.ok(!sectionsFor('operator').some((s) => s.title === 'Admin'));
  assert.ok(sectionsFor('operator').every((s) => s.links.length > 0));
});
test('the phone bottom bar keeps its links', () => {
  assert.deepEqual(mobileLinksFor('supervisor').map((l) => l.href), ['/scan', '/waves', '/inventory', '/adjust', '/dashboard']);
  assert.deepEqual(mobileLinksFor('operator').map((l) => l.href), ['/scan', '/waves', '/inventory', '/warehouse']);
});
test('Home is not a nav item; the main button suits the role', () => {
  assert.ok(!hrefs('admin').includes('/home'));
  assert.deepEqual(homePrimary('supervisor'), { href: '/dashboard', label: 'Buka dashboard' });
  assert.deepEqual(homePrimary('admin'), { href: '/dashboard', label: 'Buka dashboard' });
  assert.deepEqual(homePrimary('operator'), { href: '/scan', label: 'Buka Scan' });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
