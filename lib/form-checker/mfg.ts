import { uomLabel } from "@/lib/allocator/picklist";
import { lookupUom } from "@/lib/allocator/uom-master";

/** Units whose pallet card prints the manufacture date beside the batch. */
export const MFG_DATE_UNITS = ["Drum", "Pail", "IBC", "Fluidbag"] as const;

/**
 * The unit a pallet card's item is handled in. SAP and the Form Checker only
 * say CAR / EA; the drum / pail / IBC / fluidbag split comes from the same
 * per-SKU table the picklist prints (lib/allocator/uom-master.ts), then the
 * item master, then the file.
 */
export function cardUnit(sku: string, masterUom: string | null | undefined, fileUom: string | null | undefined): string {
  return uomLabel(lookupUom(sku) ?? masterUom ?? fileUom ?? null);
}

export function showsMfgDate(sku: string, masterUom?: string | null, fileUom?: string | null): boolean {
  const unit = cardUnit(sku, masterUom, fileUom).toLowerCase();
  return MFG_DATE_UNITS.some((u) => u.toLowerCase() === unit);
}
