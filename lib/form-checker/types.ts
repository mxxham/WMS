/** Form Checker card — one per pallet row, all fields as strings/numbers/null per the spec. */
export type FormCheckerCard = {
  /** Shipment context: month (e.g. "JUNE") */
  month: string;
  /** Shipment context: user name (e.g. "YUDI") */
  userName: string;
  /** Shipment context: shipment number (e.g. 109717235) */
  shipmentNo: number;
  /** Item context: item code / SKU (e.g. 550074326) */
  itemCode: number;
  /** Item context: ordered quantity */
  qtyOrder: number;
  /** Item context: order UoM (e.g. "CAR", "EA") */
  orderUom: string;
  /** Item context: ASN number (may be empty) */
  asnNo: string | null;
  /** Item context: Vendor ASN / Delivery No (may be empty) */
  vendorAsnNo: string | null;
  /** Per-pallet: actual quantity received */
  actQty: number | null;
  /** Per-pallet: actual UoM (e.g. "CAR", "EA") */
  actUom: string;
  /** Per-pallet: 12-digit SSCC pallet ID (e.g. "540000849095") */
  palletId: string;
  /** Per-pallet: bin location (may be empty) */
  binLocation: string | null;
  /** Item context: GR number (may be empty) */
  grNo: string | null;
  /** Item context: batch number (may be empty) */
  batchNo: string | null;
  /** Item context: manufacture date as "DD/MM/YYYY" (may be empty) */
  mfgDate: string | null;
  /** Item context: expiry date as "DD/MM/YYYY" (may be empty) */
  expDate: string | null;
  /** Item context: putaway number (may be empty) */
  putawayNo: string | null;
};