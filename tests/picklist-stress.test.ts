/**
 * Stress: random order loads against each real workbook's stock, checked with
 * the same invariants as tests/b2b-sisa-consistency.test.ts. Every order line
 * is well under a full pallet (mostly 1-3 cartons or up to a quarter pallet),
 * so pallets get opened and topped up into the pickface over and over — with
 * the same SKU across many shipments, repeated SKU lines in one shipment,
 * unknown SKUs, shared waves and mixed slot times. Pickfaces are all automatic
 * here; tests/picklist-stress-dedicated.test.ts runs the same load with
 * dedicated ones.
 *
 * Seeded, so every failure is reproducible: STRESS_SEED=<seed> replays one
 * case, STRESS_CASES=<n> changes how many run per stock day.
 */
import { runStress } from './helpers/stress';

runStress('Picklist stress (random orders, automatic pickfaces)', 0, () => ({}));
