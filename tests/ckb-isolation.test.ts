/**
 * CKB 3PL — static guards over the source tree: CKB code never touches Shell stock, every CKB page
 * and API route has its own gate, every navigation item has a page, and the service-role client
 * never reaches the browser. (The database side is supabase/tests/65-69.)
 */
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CKB_NAV } from '../lib/ckb/permissions';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const walk = (dir: string): string[] => existsSync(dir)
  ? readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; })
  : [];
const src = (p: string) => readFileSync(p, 'utf8');
// The rebagging module predates this work and deliberately posts to the shared ledger on aisles CG/CH
// (0084-0086); it is excluded here and documented in docs/CKB_3PL.md §9.
const ckbFiles = [...walk('app/ckb'), ...walk('app/api/ckb'), ...walk('lib/ckb'), ...walk('components/ckb')]
  .filter((f) => !f.startsWith(join('app', 'ckb', 'rebagging')) && !f.endsWith('lib/ckb/rebagging.ts'));

const SHELL_TABLES = ['movements', 'inventory', 'inventory_detail', 'pick_tasks', 'waves', 'outbound', 'bins', 'items', 'stock_holds',
  'count_tasks', 'adjustment_requests', 'receipts', 'pickfaces', 'shipment_loads', 'stock_recons'];
const SHELL_RPCS = ['save_plan', 'post_task', 'post_pick_line', 'import_snapshot', 'complete_wave', 'post_wave_sheet', 'apply_adjustment', 'post_adjustment'];

console.log('\nCKB isolation');

test('CKB code reads and writes no Shell stock table', () => {
  for (const f of ckbFiles) {
    const s = src(f);
    for (const t of SHELL_TABLES) assert.ok(!s.includes(`from("${t}")`) && !s.includes(`from('${t}')`), `${f} uses Shell table ${t}`);
  }
});

test('CKB code calls no Shell stock RPC and no allocator', () => {
  for (const f of ckbFiles) {
    const s = src(f);
    for (const r of SHELL_RPCS) assert.ok(!s.includes(`rpc("${r}"`) && !s.includes(`rpc('${r}'`), `${f} calls Shell RPC ${r}`);
    assert.ok(!s.includes('lib/allocator') && !s.includes('@/lib/allocator'), `${f} imports the Shell allocator`);
  }
});

const CKB_MIGRATIONS = readdirSync('supabase/migrations').filter((m) => /^0(099|10[0-7]|133)_/.test(m));
const functionsOf = (sql: string) => new Map([...sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?end \$\$;/g)].map((m) => [m[1], m[0]]));

test('CKB migrations alter only ckb_ tables and write no Shell stock (0106 is checked separately)', () => {
  assert.equal(CKB_MIGRATIONS.length, 10, CKB_MIGRATIONS.join(', '));  // 0099-0107 + 0133 (blind count)
  for (const f of CKB_MIGRATIONS) {
    const s = src(join('supabase/migrations', f));
    // 0105 (app isolation) changes Shell functions/policies on purpose; it alters no table.
    for (const t of [...s.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1])) assert.ok(t.startsWith('ckb_'), `${f} alters ${t}`);
    if (f.startsWith('0106')) continue;
    assert.ok(!/insert into public\.(movements|inventory)\b/.test(s), `${f} writes Shell stock`);
  }
});

test('0106 copies the rebagging functions verbatim: only the role check differs from 0085/0087', () => {
  const original = new Map([...functionsOf(src('supabase/migrations/0085_rebagging_rpcs.sql')), ...functionsOf(src('supabase/migrations/0087_admin_delete_rebagging.sql'))]);
  const copies = functionsOf(src('supabase/migrations/0106_ckb_rebagging_roles.sql'));
  let compared = 0;
  for (const [name, body] of copies) {
    if (!original.has(name)) continue;
    const back = body
      .replaceAll("public.ckb_has_role(array['supervisor','admin'])", "public.has_role(array['supervisor','admin']::public.user_role[])")
      .replaceAll("public.ckb_has_role(array['admin'])", "public.has_role(array['admin']::public.user_role[])");
    assert.equal(back, original.get(name), `${name} differs from its original beyond the role check`);
    compared++;
  }
  assert.equal(compared, 7);
});

test('every CKB page gates itself (requireCkb), except the layout-handled dashboard', () => {
  for (const f of walk('app/ckb').filter((p) => p.endsWith('page.tsx'))) {
    const s = src(f);
    if (f === join('app', 'ckb', 'page.tsx')) { assert.ok(s.includes('getCkbUser') && s.includes('isStaff'), 'dashboard must check the CKB role'); continue; }
    assert.ok(s.includes('requireCkb('), `${f} has no requireCkb gate`);
  }
});

test('every CKB API route checks the CKB role before anything else', () => {
  const routes = walk('app/api/ckb').filter((p) => p.endsWith('route.ts'));
  assert.ok(routes.length >= 6, 'expected the CKB API routes');
  for (const f of routes) assert.ok(src(f).includes('checkCkb('), `${f} has no checkCkb gate`);
});

test('the service-role client is never imported by client code', () => {
  for (const f of [...walk('app/ckb'), ...walk('components/ckb')]) {
    const s = src(f);
    if (s.startsWith('"use client"') || s.startsWith("'use client'")) {
      assert.ok(!s.includes('createServiceClient') && !s.includes('SERVICE_ROLE'), `${f} is a client file with service-role access`);
      assert.ok(!s.includes('@/lib/supabase/server'), `${f} imports the server Supabase client`);
    }
  }
});

test('every navigation item has a page', () => {
  for (const g of CKB_NAV) for (const i of g.items) {
    const page = join('app', ...i.href.split('/').filter(Boolean), 'page.tsx');
    assert.ok(existsSync(page), `${i.href} has no ${page}`);
  }
});

test('the IA routes of the brief all exist', () => {
  for (const r of ['ckb/stock-take/new', 'ckb/stock-take/[id]', 'ckb/stock-take/[id]/count', 'ckb/stock-take/[id]/discrepancies',
    'ckb/stock-take/[id]/review', 'ckb/stock-take/[id]/export', 'ckb/rebagging/new', 'ckb/rebagging/[id]', 'ckb/inspections/new',
    'ckb/inspections/[id]', 'ckb/sap/import/[id]', 'ckb/sap/compare', 'ckb/sap/export/[id]']) {
    assert.ok(existsSync(join('app', r, 'page.tsx')), `missing app/${r}/page.tsx`);
  }
});

test('CKB pages link to no Shell route', () => {
  for (const f of ckbFiles.filter((p) => p.endsWith('.tsx'))) {
    const s = src(f);
    for (const r of ['"/scan"', '"/waves"', '"/dashboard"', '"/home"', '"/inventory"', '"/allocate"']) assert.ok(!s.includes(`href=${r}`), `${f} links to ${r}`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
