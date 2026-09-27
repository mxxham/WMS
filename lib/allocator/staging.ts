import type { StockBin } from './types';

/**
 * Stock sitting in an outbound staging location (STAGING, STG_01, ...). It is
 * already off the rack, so it is never a pickface, never a sealed pallet
 * (isFullPallet false: a pick here is a hand pick that opens nothing and
 * triggers no Bin To Bin), and it has no place on the rack pick path.
 */
export function stagingBin(
  location: string,
  sku: string,
  batch: string | null,
  expiryDate: Date,
  qty: number,
  upp: number,
  extra: Pick<StockBin, 'description' | 'grDate' | 'uom'>,
): StockBin {
  return {
    binId: `${location}|${sku}|${batch ?? 'NOBATCH'}`,
    location,
    aisle: '',
    bay: 0,
    level: '',
    position: 0,
    sku,
    batch,
    expiryDate,
    qtyCartons: qty,
    upp,
    isFullPallet: false,
    ...extra,
  };
}
