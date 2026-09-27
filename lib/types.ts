export type Role = "admin" | "supervisor" | "operator";
export type MovementType = "inbound" | "putaway" | "picking" | "transfer" | "adjustment";

export type Bin = {
  id: string; bin_code: string; zone: string; rack: string | null; level: string | null;
  position: string | null; abc_class: string | null; capacity: number | null;
  pos_x: number | null; pos_y: number | null; pos_z: number | null; status: "active" | "blocked";
};

export type InventoryRow = {
  id: string; bin_id: string; item_id: string; batch_lot: string; quantity: number;
  expiry_date: string | null; received_date: string | null;
  items: { sku: string; description: string; uom: string | null; abc_class: string | null; upp: number | null } | null;
  /** Cartons of this line on hold (0017), and why. */
  held?: number; hold_reasons?: string | null;
};

export type Movement = {
  id: string; type: MovementType; quantity: number; batch_lot: string; created_at: string; note: string | null;
  reason_code?: string | null; by_name?: string | null; approved_by_name?: string | null;
  items: { sku: string; description: string } | null;
  from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null;
  profiles: { name: string } | null;
};
