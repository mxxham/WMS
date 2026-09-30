import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/fetch-all';
import { withConfig, type AllocatorConfig } from '../config';
import { inventoryToStock, type InventoryRow } from '../adapters/inventory-stock';
import { runPipeline, type PipelineResult } from '../pipeline';
import { buildPlan } from '../plan';
import type { DemandLine } from '../types';

/**
 * Browser-side planning against the database (supabase/migrations/0007).
 *
 * Stock for a plan = physical stock minus what open tasks of OTHER waves
 * will still take, plus what they will still bring in (planning_stock).
 * A plan for a date replaces only that date's untouched waves; waves that
 * have been worked on, paused or cancelled are kept and their shipments
 * are not planned again.
 */

export interface PlanContext {
  replaceable: { id: string; wave_no: string; shipment_numbers: string[]; truck: string | null; destination: string; planned_slot: string | null }[];
  kept: { id: string; wave_no: string; status: string; shipment_numbers: string[] }[];
}

export interface SaveResult { waves: number; tasks: number; outbound: number; replaced: number; kept: number }

const STOCK_COLUMNS = 'bin_code, bin_status, sku, description, uom, upp, batch_lot, quantity, expiry_date, received_date';

export async function loadPlanContext(db: SupabaseClient, date: string): Promise<PlanContext> {
  const { data, error } = await db.rpc('plan_context', { p_date: date });
  if (error) throw new Error(error.message);
  return data as PlanContext;
}

/**
 * Stock rows free for a plan of `date`, in the shape inventoryToStock() expects.
 * `release`: parked waves whose reservation counts as free (they are cancelled
 * and planned fresh when the plan is saved, 0037).
 */
export async function loadPlanningStock(db: SupabaseClient, date: string, release: string[] = [], keepAll = false): Promise<InventoryRow[]> {
  return fetchAll<InventoryRow>((from, to) =>
    // planning_stock returns a table; supabase-js types an untyped RPC as "row or rows".
    // keepAll (0044): an order added to the day keeps every reservation, also the day's untouched waves'.
    db.rpc('planning_stock', { p_date: date, p_release: release, p_keep_all: keepAll }).select(STOCK_COLUMNS)
      .order('bin_code').order('sku').order('batch_lot').order('expiry_date')
      .range(from, to) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
}

/** Fixed pickfaces (0009) as config.pickfaceOverrides: SKU -> bin code. */
export async function loadPickfaceOverrides(db: SupabaseClient): Promise<Record<string, string>> {
  const { data, error } = await db.from('pickface_detail').select('sku, bin_code');
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((r) => [r.sku as string, r.bin_code as string]));
}

/**
 * Dispatch rules from inventory control (0016): the policy's minimum days of
 * life left, and per-SKU overrides from the item master.
 */
export async function loadDispatchRules(db: SupabaseClient): Promise<Pick<AllocatorConfig, 'minRemainingShelfLifeDays' | 'minRemainingShelfLifeDaysBySku'>> {
  const [{ data: policy, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    db.rpc('inventory_policy'),
    db.from('items').select('sku, min_dispatch_days').not('min_dispatch_days', 'is', null),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  return {
    minRemainingShelfLifeDays: Number((policy as { min_dispatch_days?: number } | null)?.min_dispatch_days ?? 0),
    minRemainingShelfLifeDaysBySku: Object.fromEntries((items ?? []).map((i) => [i.sku as string, Number(i.min_dispatch_days)])),
  };
}

/** Shipments already owned by kept waves: a new plan must not touch them. */
export function keptShipments(ctx: PlanContext): Set<string> {
  return new Set(ctx.kept.flatMap((w) => w.shipment_numbers));
}

export async function savePlan(db: SupabaseClient, date: string, run: PipelineResult, demand: DemandLine[]): Promise<SaveResult> {
  const plan = buildPlan(run.allocation, demand, run.pickfaces);
  const { data, error } = await db.rpc('save_plan', { p_date: date, p_plan: plan });
  if (error) throw new Error(error.message);
  return data as SaveResult;
}

type OutboundDemandRow = {
  wave_id: string; shipment_number: string; sku: string; description: string; order_nos: string[];
  truck: string | null; destination: string; quantity_requested: number; items: { upp: number | null } | null;
};

/**
 * Re-plans the untouched waves of `date` from current stock, without the
 * workbook: their demand is read back from the saved outbound rows.
 */
export async function replanRemaining(
  db: SupabaseClient,
  date: string,
  overrides: Partial<AllocatorConfig> = {},
): Promise<{ result: SaveResult; run: PipelineResult } | null> {
  const ctx = await loadPlanContext(db, date);
  if (ctx.replaceable.length === 0) return null;
  const waveById = new Map(ctx.replaceable.map((w) => [w.id, w]));

  const { data, error } = await db.from('outbound')
    .select('wave_id, shipment_number, sku, description, order_nos, truck, destination, quantity_requested, items(upp)')
    .in('wave_id', [...waveById.keys()]);
  if (error) throw new Error(error.message);

  const demand: DemandLine[] = (data as unknown as OutboundDemandRow[]).map((o) => {
    const w = waveById.get(o.wave_id)!;
    return {
      shipmentNumber: o.shipment_number,
      waveNo: w.wave_no,
      orderNos: o.order_nos ?? [],
      sku: o.sku,
      description: o.description,
      qtyCartons: Number(o.quantity_requested),
      upp: Number(o.items?.upp) || 1,
      destination: o.destination,
      shipToLocation: o.destination,
      transport: o.truck,
      truckType: o.truck,
      slotTime: w.planned_slot,
      deliveryDate: null,
    };
  });

  const config = withConfig({ asOf: new Date(`${date}T00:00:00Z`), pickfaceOverrides: await loadPickfaceOverrides(db),
    ...(await loadDispatchRules(db)), ...overrides });
  const stock = inventoryToStock(await loadPlanningStock(db, date), config);
  const run = runPipeline(stock.stock, demand, stock.stagedBySku, config, stock.warnings);
  return { result: await savePlan(db, date, run, demand), run };
}
