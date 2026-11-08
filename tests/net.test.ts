import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { isNetworkError, NETWORK_MSG } from "../lib/net";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

// The raw wordings a fetch failure gets inside error.message, per browser and runtime.
// Chromium (postgrest resolves the TypeError into the error object verbatim).
test('Chromium: "Failed to fetch" is a network error', () => {
  assert.ok(isNetworkError(new Error("TypeError: Failed to fetch")));
});
// Gecko — the wording the operators reported (Firefox / a Gecko-based phone browser).
test('Gecko: "NetworkError when attempting to fetch resource." is a network error', () => {
  assert.ok(isNetworkError(new Error("TypeError: NetworkError when attempting to fetch resource.")));
});
test("WebKit and undici wordings are network errors, capitalized or not", () => {
  assert.ok(isNetworkError(new Error("Load failed")));
  assert.ok(isNetworkError(new Error("fetch failed")));
});
// supabase-js wraps the thrown fetch failure; the original keeps travelling
// down the `cause` chain (auth-js: postgrest: undici cause).
test("the cause chain is walked: an Error wrapping the raw failure still matches", () => {
  const wrapped = new Error("request failed", { cause: new TypeError("Failed to fetch") });
  assert.ok(isNetworkError(wrapped));
});

// Ordinary database and business errors must keep their own message.
test("SQL and PostgREST errors are NOT network errors", () => {
  for (const m of [
    "permission denied for table bins",
    "Stok ini dipesan untuk tugas lain (#PT-12).",
    "Cannot connect: invalid arguments", // contains nothing fetch-related
    "null value in column \"batch_lot\" does not conform to the constraint",
    "PGRST116 multiple (or no) rows returned",
  ]) {
    assert.ok(!isNetworkError(new Error(m)), m);
  }
});
test("not an Error at all: refused without throwing", () => {
  for (const v of [undefined, null, 42, "TypeError: Failed to fetch", { message: "failed to fetch" }]) {
    assert.ok(!isNetworkError(v), String(v));
  }
});

test("the message is the operator's Indonesian sentence", () => {
  assert.equal(NETWORK_MSG, "Periksa jaringan dan internet.");
});

// Wiring: the browser surfaces are the points where the raw wording leaked.
// File reads like login-wiring.test.ts — running them would take a browser.
test("the Supabase browser client routes every call through offlineFetch", () => {
  const src = readFileSync("lib/supabase/client.ts", "utf8");
  assert.ok(src.includes("offlineFetch"), "client.ts must import offlineFetch");
  assert.match(src, /global:\s*\{\s*fetch:\s*offlineFetch\s*\}/, "fetch must be passed as global.fetch");
});
test("login refuses before the server action when the device is offline", () => {
  const src = readFileSync("app/login/login-form.tsx", "utf8");
  assert.ok(src.includes("navigator.onLine"), "the form must check navigator.onLine");
  assert.ok(src.includes("NETWORK_MSG"), "the refusal reuses lib/net's message");
});
test("the direct fetch call sites belong to offlineFetch", () => {
  for (const [file, needle] of [
    ["app/(app)/warehouse/warehouse-client.tsx", "offlineFetch"],
    ["app/(app)/labels/labels-client.tsx", "offlineFetch"],
    ["app/(app)/labels/pallet/pallet-client.tsx", "offlineFetch"],
    ["components/ckb/evidence-panel.tsx", "offlineFetch"],
  ] as const) {
    const src = readFileSync(file, "utf8");
    assert.ok(src.includes(needle) && !src.includes("await fetch("), `${file}: no raw fetch left`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
