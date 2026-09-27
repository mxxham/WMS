export type BinSummary = {
  id: string; bin_code: string; zone: string; rack: string | null; level: string | null; position: string | null;
  status: "active" | "blocked"; capacity: number | null;
  pos_x: number | null; pos_y: number | null; pos_z: number | null;
  abc_class: string | null; total_qty: number; fill_ratio: number | null; min_expiry: string | null; skus: string[];
};

export type Layout = {
  aisle_order: string[]; bay_width_m: number; rack_depth_m: number; level_height_m: number;
  aisle_width_m: number; positions_per_bay: number;
  /** Bays per face of a back-to-back block (rack 21 behind rack 01). 0 = single-row aisles. */
  bays_per_side?: number; floor_zone_origin: { x: number; z: number };
};

export type ColorMode = "abc" | "fill" | "expiry";
