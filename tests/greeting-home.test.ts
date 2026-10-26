import { strict as assert } from "node:assert";
import { GREETING_BUCKETS, greetingLinesFor, pickGreeting } from "../components/app/about-copy";

// The Home banner's greeting (components/app/about-copy.ts): six time-of-day buckets, exactly five
// lines each, one picked per server request. These pin the bucket boundaries to the WIB clock the
// page computes, because a greeting that drifts by an hour greets the night shift as pagi.

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

test("six buckets, exactly five lines each, none blank", () => {
  assert.equal(GREETING_BUCKETS.length, 6);
  for (const b of GREETING_BUCKETS) {
    assert.equal(b.lines.length, 5, `bucket starting at ${b.starts}`);
    for (const line of b.lines) assert.ok(line.trim().length > 0, `blank line in ${b.starts}`);
  }
});

test("buckets own their owner-set hours, in order (tengah malam wraps midnight)", () => {
  const spans = GREETING_BUCKETS.map((b) => `${b.starts}-${b.ends}`);
  assert.deepEqual(spans, ["5-11", "11-13", "13-15", "15-18", "18-23", "23-5"],
    "pagi, tengah hari, siang, sore, malam, tengah malam — exactly as the owner set them");
});

test("every edge hour belongs to its own bucket", () => {
  // [hour, bucket index]: the page passes integer hours, so each edge is a spoken decision.
  const edges: Array<[number, number]> = [
    [0, 5], [4, 5], [23, 5],       // tengah malam, including both midnight sides
    [5, 0], [10, 0],               // pagi
    [11, 1], [12, 1],              // tengah hari
    [13, 2], [14, 2],              // siang
    [15, 3], [17, 3],              // sore
    [18, 4], [22, 4],              // malam
  ];
  for (const [hour, idx] of edges) {
    assert.equal(greetingLinesFor(hour), GREETING_BUCKETS[idx].lines, `${String(hour).padStart(2, "0")}:xx`);
  }
});

test("substitution follows the line: named lines get the name, bare lines stay bare", () => {
  const lines = GREETING_BUCKETS[0].lines; // 09:xx -> pagi
  const bare = lines.filter((l) => !l.includes("{nama}"));
  assert.ok(bare.length > 0, "the owner's copy keeps some pagi lines nameless");
  for (let i = 0; i < 60; i++) {
    const greeting = pickGreeting(9, "Ilham");
    // either the name went in, or the line never carried a slot for it — never a leaked {nama}.
    assert.ok(greeting.includes("Ilham") || bare.includes(greeting), greeting);
    assert.ok(!greeting.includes("{nama}"), greeting);
  }
});

test("randomness really changes the line between calls", () => {
  const picked = new Set(Array.from({ length: 40 }, () => pickGreeting(12, "Uji")));
  assert.ok(picked.size >= 2, "40 picks from 5 lines gave only one outcome");
});

process.exitCode = failed > 0 ? 1 : 0;
if (failed > 0) console.log(`\n${failed} failed, ${passed} passed`);
else console.log(`\nall ${passed} passed`);
