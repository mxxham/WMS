import { allocate, relocateByWaveOrder } from './allocator';
import type { AllocatorConfig } from './config';
import { detectDoubles, type DoubleEntry } from './double';
import { settleSisa } from './ledger';
import { buildMovementReport } from './movement';
import { derivePickfaces } from './pickface';
import { annotateRestNotes, buildPicklists } from './picklist';
import type { AllocationResult, DemandLine, MovementRow, PickfaceAssignment, StockBin, Warning } from './types';

export interface PipelineResult {
  allocation: AllocationResult;
  pickfaces: Map<string, PickfaceAssignment>;
  movement: MovementRow[];
  doubles: { pickDoubles: DoubleEntry[]; total: number };
}

/** The full daily run, whatever the stock source: allocate → relocate → picklists → reports. */
export function runPipeline(
  stock: StockBin[],
  demand: DemandLine[],
  stagedBySku: Map<string, number>,
  config: AllocatorConfig,
  inputWarnings: Warning[] = [],
): PipelineResult {
  const pickfaces = derivePickfaces(stock, config);
  const allocation = allocate(stock, demand, config, stagedBySku);
  allocation.warnings.unshift(...inputWarnings);
  relocateByWaveOrder(allocation.lines, pickfaces, config, stock);
  allocation.picklists = buildPicklists(allocation, demand, config);
  // Sisa in the exact printed order (which is also the plan's task order).
  for (const l of settleSisa(allocation.picklists.flatMap((p) => p.lines), stock)) {
    allocation.warnings.push({ level: 'WARN', code: 'SISA_NEGATIVE',
      message: `${l.location} ${l.sku} batch ${l.batch ?? '-'}: stok tidak cukup pada urutan picklist (shipment ${l.shipmentNumber})`,
      context: { location: l.location, sku: l.sku } });
  }
  // An opened pallet without a move says where its rest goes later (after settleSisa: final moves).
  annotateRestNotes(allocation.picklists.flatMap((p) => p.lines));
  return {
    allocation,
    pickfaces,
    movement: buildMovementReport(allocation),
    doubles: detectDoubles(allocation),
  };
}
