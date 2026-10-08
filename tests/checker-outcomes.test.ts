import { strict as assert } from "node:assert";
import { CHECK_OUTCOMES, CHECK_OUTCOME_META, OUTCOME_TONE_CLASS } from "../lib/checker-outcomes";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

test("the four scan outcomes exist exactly once", () => {
  assert.deepEqual([...CHECK_OUTCOMES].sort(), ["ACCEPTED", "OVER_SCAN", "UNKNOWN_BARCODE", "WRONG_ITEM"]);
});

test("every outcome carries a label, tone, icon, sound and vibration", () => {
  for (const o of CHECK_OUTCOMES) {
    const m = CHECK_OUTCOME_META[o];
    assert.ok(m.label.length > 0, `${o} has a label`);
    assert.ok(["ok", "warn", "bad"].includes(m.tone), `${o} tone`);
    assert.ok(["check", "question", "wrong", "over"].includes(m.icon), `${o} icon`);
    assert.ok(m.beeps.length > 0 && m.beeps.every((b) => b.freq > 0 && b.ms > 0), `${o} beeps`);
    assert.ok(m.vibrate.length > 0 && m.vibrate.every((v) => v > 0), `${o} vibration`);
    assert.ok(OUTCOME_TONE_CLASS[m.tone].length > 0, `${o} tone class`);
  }
});

test("colour is never the only signal: icon, sound and vibration are unique per outcome", () => {
  const icons = new Set(CHECK_OUTCOMES.map((o) => CHECK_OUTCOME_META[o].icon));
  const beeps = new Set(CHECK_OUTCOMES.map((o) => JSON.stringify(CHECK_OUTCOME_META[o].beeps)));
  const vibs = new Set(CHECK_OUTCOMES.map((o) => JSON.stringify(CHECK_OUTCOME_META[o].vibrate)));
  assert.equal(icons.size, CHECK_OUTCOMES.length, "one icon per outcome");
  assert.equal(beeps.size, CHECK_OUTCOMES.length, "one sound per outcome");
  assert.equal(vibs.size, CHECK_OUTCOMES.length, "one vibration per outcome");
});

test("accepted is the only ok tone; the problems are warn or bad", () => {
  assert.equal(CHECK_OUTCOME_META.ACCEPTED.tone, "ok");
  assert.notEqual(CHECK_OUTCOME_META.UNKNOWN_BARCODE.tone, "ok");
  assert.notEqual(CHECK_OUTCOME_META.WRONG_ITEM.tone, "ok");
  assert.notEqual(CHECK_OUTCOME_META.OVER_SCAN.tone, "ok");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
