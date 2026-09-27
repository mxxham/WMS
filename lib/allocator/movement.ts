import type { AllocationResult, MovementRow } from './types';

/**
 * One chronological ledger of every bin quantity change this run made:
 * outbound picks (bin → shipment/staging) and pallet-break relocations
 * (reserve bin → pickface bin). This is the "what moved, from what item to
 * where" report — the paper trail for what the picklist did to the WMS sheet.
 */
export function buildMovementReport(
  allocation: AllocationResult,
): MovementRow[] {
  const rows: MovementRow[] = [];
  let seq = 1;

  // Printed order (= the plan's task order), so the rows read chronologically.
  const lines = allocation.picklists.length ? allocation.picklists.flatMap((p) => p.lines) : allocation.lines;
  for (const l of lines) {
    rows.push({
      seq: seq++,
      type: 'PICK',
      sku: l.sku,
      description: l.description,
      batch: l.batch,
      expiryDate: l.expiryDate,
      qty: l.qtyPick,
      pickType: l.pickType,
      uom: l.uom,
      fromLocation: l.location,
      toLocation: `STAGING → ${l.shipmentNumber}`,
      shipmentNumber: l.shipmentNumber,
      // What stays at the source after the pick (before the move, if any).
      qtyRemainingAtFrom: l.qtyRemainingInBin + l.moveQty,
      breaksPallet: l.breaksPallet,
    });
    if (l.moveQty > 0 && l.moveTo) {
      rows.push({
        seq: seq++,
        type: 'REPLEN',
        sku: l.sku,
        description: l.description,
        batch: l.batch,
        expiryDate: l.expiryDate,
        qty: l.moveQty,
        pickType: 'CASE',
        uom: l.uom,
        fromLocation: l.location,
        toLocation: `${l.moveTo} (pickface)`,
        shipmentNumber: null,
        qtyRemainingAtFrom: l.qtyRemainingInBin,
        breaksPallet: true,
      });
    }
  }

  return rows;
}
