/**
 * CKB 3PL — role/route matrix and navigation (lib/ckb/permissions.ts). The database is the
 * authorization layer (supabase/tests/65_ckb_access.sql); this pins what each role is shown.
 */
import { strict as assert } from 'node:assert';
import { canAccess, navFor, CKB_NAV, CKB_ROUTES, isCkbRole, isStaff, isLead } from '../lib/ckb/permissions';
import { resolveAppsHome } from '../lib/apps';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

console.log('\nCKB access');

test('no role, no access: a CKB-app account without a CKB role opens nothing', () => {
  for (const r of CKB_ROUTES) assert.equal(canAccess(null, r.prefix.replace('*', 'x')), false, r.prefix);
});

test('unknown /ckb paths are refused for every role (fail closed)', () => {
  for (const role of ['admin', 'supervisor', 'operator', 'customer'] as const) {
    assert.equal(canAccess(role, '/ckb/secret'), false);
    assert.equal(canAccess(role, '/ckbx'), false);
    assert.equal(canAccess(role, '/'), false);
  }
});

test('representatives: dashboard, reports, photos, read-only inspections and stock takes', () => {
  const ok = ['/ckb', '/ckb/reports', '/ckb/photos', '/ckb/inspections', '/ckb/inspections/abc', '/ckb/stock-take', '/ckb/stock-take/abc'];
  for (const p of ok) assert.equal(canAccess('customer', p), true, p);
});

test('representatives never reach internal administration or operations', () => {
  const no = ['/ckb/users', '/ckb/settings', '/ckb/customers', '/ckb/activity', '/ckb/sap/import', '/ckb/sap/export',
    '/ckb/inventory', '/ckb/rebagging', '/ckb/rebagging/x', '/ckb/stock-take/new', '/ckb/stock-take/abc/count',
    '/ckb/stock-take/abc/review', '/ckb/stock-take/abc/discrepancies', '/ckb/stock-take/abc/export', '/ckb/inspections/new'];
  for (const p of no) assert.equal(canAccess('customer', p), false, p);
});

test('operators count and inspect but do not review, import, export or administer', () => {
  for (const p of ['/ckb/stock-take/abc/count', '/ckb/inspections/new', '/ckb/rebagging', '/ckb/inventory', '/ckb/photos'])
    assert.equal(canAccess('operator', p), true, p);
  for (const p of ['/ckb/stock-take/new', '/ckb/stock-take/abc/review', '/ckb/sap/import', '/ckb/sap/export', '/ckb/reports',
    '/ckb/activity', '/ckb/users', '/ckb/settings'])
    assert.equal(canAccess('operator', p), false, p);
});

test('supervisors run stock takes, SAP and reports; only admins manage users and settings', () => {
  for (const p of ['/ckb/stock-take/new', '/ckb/stock-take/abc/review', '/ckb/sap/import', '/ckb/sap/export', '/ckb/reports', '/ckb/activity', '/ckb/customers'])
    assert.equal(canAccess('supervisor', p), true, p);
  assert.equal(canAccess('supervisor', '/ckb/users'), false);
  assert.equal(canAccess('supervisor', '/ckb/settings'), false);
  assert.equal(canAccess('admin', '/ckb/users'), true);
  assert.equal(canAccess('admin', '/ckb/settings'), true);
});

test('query strings and trailing slashes do not change the answer', () => {
  assert.equal(canAccess('customer', '/ckb/users?x=1'), false);
  assert.equal(canAccess('operator', '/ckb/stock-take/abc/count/'), true);
  assert.equal(canAccess('customer', '/ckb?ditolak=1'), true);
});

test('every navigation item points at a route with a rule', () => {
  for (const g of CKB_NAV) for (const i of g.items)
    assert.ok(['admin', 'supervisor', 'operator', 'customer'].some((r) => canAccess(r as 'admin', i.href)), i.href);
});

test('navigation per role shows only what it may open, groups without items dropped', () => {
  const rep = navFor('customer').flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(rep.sort(), ['/ckb', '/ckb/inspections', '/ckb/photos', '/ckb/reports', '/ckb/stock-take'].sort());
  assert.ok(!navFor('customer').some((g) => g.title === 'Administrasi'));
  assert.equal(navFor('admin').flatMap((g) => g.items).length, CKB_NAV.flatMap((g) => g.items).length);
  assert.deepEqual(navFor(null), []);
});

test('role helpers', () => {
  assert.ok(isCkbRole('customer') && !isCkbRole('owner') && !isCkbRole(null));
  assert.ok(isStaff('operator') && !isStaff('customer') && !isStaff(null));
  assert.ok(isLead('supervisor') && !isLead('operator'));
});

test('app landing is unchanged: CKB-only -> /ckb, Shell-only -> /, both -> default, none -> /akses', () => {
  assert.equal(resolveAppsHome(['ckb_3pl'], 'ckb_3pl'), '/ckb');
  assert.equal(resolveAppsHome(['shell_wms'], 'shell_wms'), '/');
  assert.equal(resolveAppsHome(['shell_wms', 'ckb_3pl'], 'ckb_3pl'), '/ckb');
  assert.equal(resolveAppsHome([], null), '/akses');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
