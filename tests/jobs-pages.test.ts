/** One page table per flowchart job: the sidebar lists and pageAllowed read the same links. */
import { strict as assert } from 'node:assert';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JOBS, jobLevel } from '../lib/jobs';
import type { Job } from '../lib/jobs';
import { homePrimary, mobileLinksFor, pageAllowed, sectionsFor } from '../components/app/nav-config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPages per job');

const hrefs = (j: Job) => sectionsFor(j).flatMap((s) => s.links.map((l) => l.href));

const EXPECTED: Record<Job, string[]> = {
  admin_inbound: ['/dashboard', '/scan', '/receiving', '/putaway', '/inventory', '/movements', '/audit/putaway', '/labels', '/labels/pallet', '/admin/items'],
  admin_outbound: ['/dashboard', '/scan', '/waves', '/allocate', '/inventory', '/audit/picking'],
  checker: ['/scan', '/receiving', '/waves', '/inventory', '/audit/picking', '/audit/putaway'],
  inventory: ['/dashboard', '/scan', '/assign', '/pickfaces', '/inventory', '/warehouse', '/adjust', '/movements', '/counts', '/data-quality', '/trace', '/admin/items', '/admin/barcode'],
  operator: ['/scan', '/waves', '/inventory', '/warehouse'],
  leader: ['/dashboard', '/scan', '/receiving', '/waves', '/assign', '/allocate', '/putaway', '/pickfaces', '/inventory', '/warehouse', '/adjust', '/movements', '/counts', '/audit/picking', '/audit/putaway', '/data-quality', '/trace', '/labels', '/labels/pallet', '/admin/items', '/admin/barcode'],
  admin: ['/dashboard', '/scan', '/receiving', '/waves', '/assign', '/allocate', '/putaway', '/pickfaces', '/inventory', '/warehouse', '/adjust', '/movements', '/counts', '/audit/picking', '/audit/putaway', '/data-quality', '/trace', '/labels', '/labels/pallet', '/admin/items', '/admin/barcode', '/admin/import', '/admin/settings', '/admin/users'],
};

for (const j of JOBS) {
  test(`${j}: sidebar hrefs equal the spec table`, () => {
    assert.deepEqual([...hrefs(j)].sort(), [...EXPECTED[j]].sort());
  });
}

test('job levels', () => {
  assert.equal(jobLevel('admin'), 'admin');
  for (const j of ['leader', 'admin_inbound', 'admin_outbound', 'inventory'] as Job[]) assert.equal(jobLevel(j), 'supervisor');
  for (const j of ['checker', 'operator'] as Job[]) assert.equal(jobLevel(j), 'operator');
});

test('pageAllowed examples', () => {
  assert.equal(pageAllowed('operator', '/waves'), true);
  assert.equal(pageAllowed('operator', '/counts'), false);
  assert.equal(pageAllowed('admin_inbound', '/allocate'), false);
  assert.equal(pageAllowed('admin_inbound', '/labels/pallet'), true);
  assert.equal(pageAllowed('checker', '/audit/picking/abc/123'), true);
  assert.equal(pageAllowed('operator', '/bin/CA01A01'), true);
  assert.equal(pageAllowed('checker', '/home'), true);
  assert.equal(pageAllowed('leader', '/admin/users'), false);
  assert.equal(pageAllowed('admin', '/admin/users'), true);
  assert.equal(pageAllowed('operator', '/nowhere'), false);
  assert.equal(pageAllowed('operator', '/wavesx'), false);
});

test('longest href wins (/labels/pallet over /labels)', () => {
  assert.equal(pageAllowed('admin_inbound', '/labels'), true);
  assert.equal(pageAllowed('inventory', '/labels/pallet'), false);
});

test('/audit index follows either audit link', () => {
  assert.equal(pageAllowed('checker', '/audit'), true);
  assert.equal(pageAllowed('admin_outbound', '/audit'), true);
  assert.equal(pageAllowed('operator', '/audit'), false);
});

function pages(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const seg = /^\(.*\)$/.test(name) ? '' : '/' + name.replace(/^\[(.+)\]$/, 'x');
      out.push(...pages(p, base + seg));
    } else if (name === 'page.tsx') out.push(base || '/');
  }
  return out;
}

test('every page.tsx under app/(app) is covered; admin opens all', () => {
  const routes = pages('app/(app)');
  assert.ok(routes.length > 20, 'found the routes');
  for (const r of routes) {
    assert.ok(JOBS.some((j) => pageAllowed(j, r)), `${r} is open to no job`);
    assert.ok(pageAllowed('admin', r), `${r} is closed to admin`);
  }
});

test('phone bar and Home main button', () => {
  assert.deepEqual(mobileLinksFor('operator').map((l) => l.href), ['/scan', '/waves', '/inventory', '/warehouse']);
  assert.equal(homePrimary('operator').href, '/scan');
  assert.equal(homePrimary('inventory').href, '/dashboard');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
