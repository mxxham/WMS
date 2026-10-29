import type { CardMaster } from "@/lib/form-checker/pdf";
import type { FormCheckerCard } from "@/lib/form-checker/types";
import { batchMfgDate } from "@/lib/batch-code";
import { packOf } from "./putaway-plan";

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

export type ReceiptHead = { doc_no: string; shipment_no: string | null; plan_date: string | null; doc_date: string | null; checked_by_name: string | null };
export type ReceiptPallet = {
  line_no: number; quantity: number; batch_lot: string | null; expiry_date: string | null; mfg_date: string | null;
  items: { sku: string; uom: string | null; description: string } | null; bins: { bin_code: string } | null;
};

/**
 * One pallet card per pallet with good stock of a checked receipt, with the bin the auto putaway chose (0118).
 * Drum / pail / IBC / fluidbag print the manufacture date (0119): the date entered at the check, else the
 * date in a Shell date-coded batch. The card's unit is the packaging (a 209 L drum recorded as EA is a Drum),
 * so the card shows the MFG DATE box for it.
 */
export function receiptCards(r: ReceiptHead, pallets: ReceiptPallet[]): { cards: FormCheckerCard[]; master: Map<string, CardMaster> } {
  const day = r.plan_date ?? r.doc_date;
  const master = new Map<string, CardMaster>();
  const cards = pallets.map((a): FormCheckerCard => {
    const sku = a.items?.sku ?? "";
    const pack = packOf(sku, a.items?.uom ?? null, a.items?.description ?? "");
    master.set(sku, { uom: pack && pack !== "Carton" ? pack : (a.items?.uom ?? null) });
    const mfg = pack && pack !== "Carton" ? (a.mfg_date ?? batchMfgDate(a.batch_lot)) : null;
    return {
      month: day ? MONTHS[Number(day.slice(5, 7)) - 1] : "", userName: r.checked_by_name ?? "",
      shipmentNo: Number(r.shipment_no ?? r.doc_no) || 0, itemCode: Number(sku), qtyOrder: Number(a.quantity),
      orderUom: a.items?.uom ?? "", asnNo: null, vendorAsnNo: r.doc_no, actQty: Number(a.quantity), actUom: a.items?.uom ?? "",
      palletId: "", binLocation: a.bins?.bin_code ?? null, grNo: null, batchNo: a.batch_lot || null,
      mfgDate: dmy(mfg), expDate: dmy(a.expiry_date), putawayNo: `${r.doc_no}-${a.line_no}`,
    };
  });
  return { cards, master };
}
