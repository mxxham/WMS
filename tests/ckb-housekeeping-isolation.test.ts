/**
 * CKB housekeeping (0157-0158): static guards over its migrations and files, next to tests/ckb-isolation.test.ts.
 * The database side is supabase/tests/117-118.
 */
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const src = (p: string) => readFileSync(p, 'utf8');
const walk = (dir: string): string[] => existsSync(dir)
  ? readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; })
  : [];

const MIG = readdirSync('supabase/migrations').filter((m) => /^01(5[789]|60)_ckb_hk_/.test(m));
const sql = MIG.map((f) => src(join('supabase/migrations', f))).join('\n');
const sql0158 = src(join('supabase/migrations', MIG.find((f) => f.startsWith('0158'))!));
const sql0159 = src(join('supabase/migrations', MIG.find((f) => f.startsWith('0159'))!));

console.log('\nCKB housekeeping isolation');

test('four migrations, 0157 to 0160', () => assert.equal(MIG.length, 4, MIG.join(', ')));

test('they alter only ckb_hk_ tables and write no Shell table', () => {
  for (const f of MIG) {
    const s = src(join('supabase/migrations', f));
    for (const m of s.matchAll(/alter table public\.(\w+)/g)) assert.ok(m[1].startsWith('ckb_hk_'), `${f} alters ${m[1]}`);
    assert.ok(!/(insert into|update|delete from) public\.(movements|inventory|bins|items)\b/.test(s), `${f} writes a Shell table`);
  }
});

test('the Shell table bins is read only by 0157 (the rack fill and Sinkron rak), never by 0158 or 0159', () => {
  for (const f of MIG) {
    const reads = /(from|join) public\.bins\b/.test(src(join('supabase/migrations', f)));
    assert.equal(reads, f.startsWith('0157'), `${f} ${reads ? 'reads' : 'does not read'} bins`);
  }
});

test('every housekeeping table has row level security and no policy allows a write', () => {
  const tables = [...sql.matchAll(/create table public\.(ckb_hk_\w+)/g)].map((m) => m[1]);
  assert.equal(tables.length, 10, tables.join(', '));
  for (const t of tables) assert.ok(sql.includes(`alter table public.${t} enable row level security`), `${t} has no RLS`);
  assert.ok(!/create policy [^;]*for (insert|update|delete|all)/i.test(sql), 'a housekeeping policy allows writes');
});

test('the photo table stores no person: no column with "name" in it', () => {
  const photos = sql0158.match(/create table public\.ckb_hk_photos \([\s\S]*?\n\);/)![0];
  const cols = [...photos.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]);
  assert.ok(cols.length >= 8, cols.join(', '));
  for (const c of cols) assert.ok(!/name/.test(c), `ckb_hk_photos.${c}`);
});

test('customers read housekeeping only through functions: no policy for the customer role on the check-in tables', () => {
  const policies = [...sql.matchAll(/create policy "([^"]+)" on public\.(ckb_hk_\w+)[\s\S]*?;/g)];
  assert.ok(policies.length >= 6);
  for (const p of policies) assert.ok(!/customer'\]/.test(p[0]) && !/ckb_can_see_customer/.test(p[0]), `${p[1]} lets a customer read ${p[2]}`);
});

test('the customer functions return no name column', () => {
  for (const fn of ['ckb_hk_customer_week', 'ckb_hk_compliance', 'ckb_hk_customer_day']) {
    const m = sql0158.match(new RegExp(`create or replace function public\\.${fn}\\(([^)]*)\\)\\s*returns table \\(([^)]*)\\)`));
    assert.ok(m, `${fn} not found`);
    assert.ok(!/(pic_|reviewed_|on_behalf_name|_name\b)/.test(m![2].replace(/area_name/g, '')), `${fn} returns ${m![2]}`);
  }
});

test('the report, dashboard and customer day functions return no person column (0159)', () => {
  const m = sql0159.match(/function public\.ckb_hk_report\([^)]*\)\s*returns table \(([^)]*)\)/);
  assert.ok(m, 'ckb_hk_report not found');
  assert.ok(!/(pic_|reviewed_|on_behalf_name|excuse|review_note)/.test(m![1].replace(/area_name/g, '')), m![1]);
  const dash = sql0159.match(/function public\.ckb_hk_dashboard[\s\S]*?\$\$;/)![0];
  assert.ok(!/(pic_name|reviewed_name|on_behalf_name|review_note|excuse_reason)/.test(dash), 'the dashboard reads a name');
});

test('0159 re-creates the grid function without granting it, and a withdrawn photo never reaches a customer', () => {
  assert.ok(!/grant execute on function[^;]*ckb_hk_grid_core/.test(sql0159));
  assert.ok(/withdrawn_at is null/.test(sql0159.match(/function public\.ckb_hk_customer_day[\s\S]*?\$\$;/)![0]));
  assert.ok(/p\.withdrawn_at is null and c\.status in/.test(sql0159), 'photo_open must refuse a withdrawn photo to a customer');
});

test('the internal grid function is not callable by the app', () => {
  assert.ok(/revoke execute on function[^;]*ckb_hk_grid_core[^;]*from public, anon/.test(sql0158));
  assert.ok(!/grant execute on function[^;]*ckb_hk_grid_core/.test(sql0158));
});

const files = [...walk('app/ckb/housekeeping'), ...walk('app/api/ckb/housekeeping')];
test('housekeeping files read no Shell table and call no Shell RPC', () => {
  assert.ok(files.length >= 8, `${files.length} files`);
  for (const f of files) {
    const s = src(f);
    for (const t of ['movements', 'inventory', 'inventory_detail', 'bins', 'items', 'pick_tasks', 'waves', 'outbound']) assert.ok(!s.includes(`from("${t}")`), `${f} reads ${t}`);
    for (const r of ['save_plan', 'post_task', 'import_snapshot', 'apply_adjustment']) assert.ok(!s.includes(`rpc("${r}"`), `${f} calls ${r}`);
  }
});

test('housekeeping pages gate themselves and its routes check the role', () => {
  for (const f of files.filter((p) => p.endsWith('page.tsx'))) assert.ok(src(f).includes('requireCkb('), `${f} has no requireCkb`);
  for (const f of files.filter((p) => p.endsWith('route.ts'))) assert.ok(src(f).includes('checkCkb('), `${f} has no checkCkb`);
});

test('the photo route stores under the check-in path, sniffs the bytes and registers as the user', () => {
  const s = src(join('app', 'api', 'ckb', 'housekeeping', 'photo', 'route.ts'));
  assert.ok(s.includes('sniffMime') && s.includes('hkPhotoPath') && s.includes('ckb_hk_register_photo'));
  assert.ok(s.indexOf('createServiceClient()') > s.indexOf('checkCkb('), 'the service client is used before the role check');
  assert.ok(s.includes('storage.remove'), 'a failed registration must remove the stored object');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
