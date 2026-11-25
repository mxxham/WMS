import { strict as assert } from 'node:assert';
import { SECTIONS, activeHref } from '../components/app/nav-config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const hrefs = SECTIONS.flatMap((s) => s.links.map((l) => l.href));

test('a nested page lights only its own link, not its parent (Label vs Kartu palet)', () => {
  assert.equal(activeHref('/labels/pallet', hrefs), '/labels/pallet');
  assert.equal(activeHref('/labels', hrefs), '/labels');
});
test('a sub-page of a link keeps that link current', () => {
  assert.equal(activeHref('/waves/abc', hrefs), '/waves');
  assert.equal(activeHref('/audit/picking/2026-11-25/SH1', hrefs), '/audit/picking');
});
test('the match is on a path boundary: /inventory2 is not /inventory', () => {
  assert.equal(activeHref('/inventory2', hrefs), undefined);
  assert.equal(activeHref('/inventory', hrefs), '/inventory');
});
test('a page with no nav link has no current link', () => {
  assert.equal(activeHref('/home', hrefs), undefined);
  assert.equal(activeHref('/', hrefs), undefined);
});
test('exactly one link is current for every link address', () => {
  for (const h of hrefs) {
    const cur = hrefs.filter((x) => x === activeHref(h, hrefs));
    assert.equal(cur.length, 1, h);
    assert.equal(activeHref(h, hrefs), h);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
