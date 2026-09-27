import { isStagingLocation, type AllocatorConfig } from '../config';
import { stagingBin } from '../staging';
import { parseLocation } from '../pickpath';
import type { StockBin, Warning } from '../types';
import { lookupUom } from '../uom-master';

/**
 * One row of the `inventory_detail` view: a (bin, SKU, batch, expiry) stock
 * record joined with its bin and item. This is the database's physical
 * identity, the same one the allocator keys its ledger on.
 */
export interface InventoryRow {
  bin_code: string;
  bin_status: 'active' | 'blocked';
  sku: string;
  description: string | null;
  uom: string | null;
  upp: number | null;
  batch_lot: string;
  quantity: number;
  expiry_date: string | null;
  received_date: string | null;
}

export interface InventoryStock {
  stock: StockBin[];
  stagedBySku: Map<string, number>;
  warnings: Warning[];
}

/** 'YYYY-MM-DD' → UTC midnight, the same convention as the workbook adapters. */
function parseDbDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Database inventory → allocator input. Applies the same eligibility rules as
 * the workbook adapter (adapters/excel-input.ts) so a workbook-fed and a
 * database-fed run over the same stock produce the same allocation.
 */
export function inventoryToStock(rows: InventoryRow[], config: AllocatorConfig): InventoryStock {
  const stock: StockBin[] = [];
  const stagedBySku = new Map<string, number>();
  const warnings: Warning[] = [];
  const excluded = config.excludedLocations.map((x) => x.toUpperCase());

  for (const r of rows) {
    const location = r.bin_code.trim().toUpperCase();
    const qty = Number(r.quantity);
    if (!(qty > 0)) continue;

    if (isStagingLocation(location, config)) {
      // A saved pick task needs the row's exact expiry to post against, so
      // staging stock without one stays out (and still explains a shortage).
      const expiryDate = parseDbDate(r.expiry_date);
      if (!expiryDate) {
        stagedBySku.set(r.sku, (stagedBySku.get(r.sku) ?? 0) + qty);
        warnings.push({
          level: 'WARN',
          code: 'MISSING_EXPIRY',
          message: `${location} ${r.sku} has no expiry date — staging stock not used`,
          context: { location, sku: r.sku, qty },
        });
        continue;
      }
      stock.push(stagingBin(location, r.sku, r.batch_lot || null, expiryDate, qty, Number(r.upp) || 1, {
        description: r.description ?? '',
        grDate: parseDbDate(r.received_date),
        uom: lookupUom(r.sku) || r.uom || null,
      }));
      continue;
    }
    if (excluded.includes(location)) continue;

    const parsed = parseLocation(location);
    if (!parsed || !config.rackLocationPattern.test(location)) {
      warnings.push({
        level: 'INFO',
        code: 'NON_RACK_LOCATION',
        message: `${location} is not a rack bin — excluded from allocation`,
        context: { location, qty },
      });
      continue;
    }

    if (r.bin_status !== 'active' || config.blockedBins.includes(location)) {
      warnings.push({
        level: 'WARN',
        code: 'BIN_NOT_ACTIVE',
        message: `${location} is blocked — excluded`,
        context: { location, sku: r.sku },
      });
      continue;
    }

    const expiryDate = parseDbDate(r.expiry_date);
    if (!expiryDate) {
      warnings.push({
        level: 'ERROR',
        code: 'MISSING_EXPIRY',
        message: `${location} ${r.sku} has no expiry date — cannot be allocated under FEFO`,
        context: { location, sku: r.sku, qty },
      });
      continue;
    }

    const upp = Number(r.upp) || 1;
    const batch = r.batch_lot || null;
    stock.push({
      binId: `${location}|${r.sku}|${batch ?? 'NOBATCH'}`,
      location,
      aisle: parsed.aisle,
      bay: parsed.bay,
      level: parsed.level,
      position: parsed.position,
      sku: r.sku,
      description: r.description ?? '',
      batch,
      expiryDate,
      grDate: parseDbDate(r.received_date),
      qtyCartons: qty,
      upp,
      uom: lookupUom(r.sku) || r.uom || null,
      isFullPallet: qty >= upp,
    });
  }

  return { stock, stagedBySku, warnings };
}
