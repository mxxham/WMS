import { BRAND } from "./brand";

/**
 * Static configuration for WSM SUB 2. Values marked CONFIRM are assumptions
 * that must be checked against the physical warehouse before go-live.
 */
export const WAREHOUSE_NAME = `${BRAND.owner} · WSM SUB 2 Surabaya`;

/** Stock expiring within this many days is shown yellow (FEFO warning). */
export const NEAR_EXPIRY_DAYS = 90;

/** Bin code format found in the WMS sheet: Aisle(2) Rack(2) Level(1) Position(2), e.g. CA01C01. */
export const RACK_BIN_REGEX = /^(C[A-Z])(\d{2})([A-E])(\d{2})$/;


/** Non-rack locations present in the sheet. They are imported as floor bins. */
export const FLOOR_LOCATIONS: Record<string, { zone: string; status: "active" | "blocked" }> = {
  STAGING: { zone: "STAGING", status: "active" },
  QUARANTINE: { zone: "QUARANTINE", status: "blocked" },
  RETN: { zone: "RETURN", status: "active" }, // 0136: returns location, like SAP's RETN
};
export const STAGING_LANE_REGEX = /^STG_(\d{2})$/;
/** Inbound staging lanes in the 22 Nov 2026 stock-take file: STG_INBV93..STG_INBV99 (empty floor spots). */
export const STAGING_INB_LANE_REGEX = /^STG_INBV(\d{2})$/;
/**
 * Names the sheet uses for a location the system already knows. The 22 Nov file lists quarantine as
 * Z_QUARANTINE (sorted last in SAP); it is the same place as QUARANTINE, so its stock must land in that bin
 * and not leave the old one to be zeroed.
 */
export const LOCATION_ALIASES: Record<string, string> = { Z_QUARANTINE: "QUARANTINE" };

/**
 * Block C (a second building, 0147): floor slots FA-01..FA-20 / FB-01..FB-20, each with ONE dedicated SKU. Mirrored in
 * SQL by bins_normalize (site = 'BLOCKC'). Group 1 = lane (FA, FB), group 2 = slot number.
 */
export const BLOCK_C_SLOT_REGEX = /^(F[A-Z])-(\d{2})$/;
export const BLOCK_C_LANES = ["FA", "FB"] as const;
export const BLOCK_C_SLOTS_PER_LANE = 20;

/**
 * Block C slot size, from the updated floor plan (master lokasi floor block C.xlsx, 23 Nov 2026): every slot is 14
 * pallet positions on the floor (40 slots = "TOTAL : 560 PP"), stacked by pack type: IBC, fluid bag and carton 2 high,
 * drum 3 high (the plan also lists "DRUM 2 STACK"; drum stays 3 until the user says which drums are 2), anything
 * else 2. The slot's capacity in pallets is positions x stack height, stored on the slot when its SKU is assigned
 * (assign_block_c_slots) and enforced by the database. Change a number here, then assign the SKU's slots again.
 */
export const POSITIONS_PER_SLOT = 14;
export const STACK_HEIGHT: Record<string, number> = { Drum: 3, Carton: 2 };
export const STACK_HEIGHT_DEFAULT = 2;
export function stackHeight(pack: string | null | undefined): number {
  return (pack && STACK_HEIGHT[pack]) || STACK_HEIGHT_DEFAULT;
}
/** Pallets one slot can hold in all (positions x stack height): the `bins.capacity` of a Block C slot. */
export function palletsPerSlot(pack: string | null | undefined): number {
  return POSITIONS_PER_SLOT * stackHeight(pack);
}

/**
 * Level colours for the rack-upright label, following the reference photo of
 * the physical rack signs (first cell = red ... last cell = blue). One cell
 * per level. This is ALSO what the printed strips and their preview show.
 */
export const LEVEL_COLORS: Record<string, { hex: string; name: string }> = {
  A: { hex: "#D7263D", name: "Merah" },
  B: { hex: "#F07C1B", name: "Oranye" },
  C: { hex: "#F6E21B", name: "Kuning" },
  D: { hex: "#3FA34D", name: "Hijau" },
  E: { hex: "#3C8DDE", name: "Biru" },
};

/**
 * Screen-only accent per level: the web look, spread over the Coastal Blues
 * ramp (deep navy → pale aqua). Printed strips do NOT use this — they keep
 * LEVEL_COLORS above so the paper matches what is already nailed to the racks.
 */
export const LEVEL_COLORS_WEB: Record<string, string> = {
  A: "#012A4A",
  B: "#01497C",
  C: "#2C7DA0",
  D: "#61A5C2",
  E: "#A9D6E5",
};

/** Order of cells on an upright strip, top to bottom (as requested: A first, E last). */
export const STRIP_LEVEL_ORDER = ["A", "B", "C", "D", "E"] as const;

/**
 * Which way the arrow points for each pallet position in a bay.
 * CONFIRM on the floor: position 01 assumed to be the left pallet when facing the rack.
 */
export const POSITION_ARROW: Record<string, "left" | "right"> = { "01": "left", "02": "right" };

/** Label geometry in millimetres. One cell = one bin code. */
export const LABEL = {
  cellWidthMm: 80,
  cellHeightMm: 85,
  arrowBlockMm: 22, // top/bottom arrow segment in continuous-strip mode
  quietZoneMm: 3,
  minBinCodePt: 28,
  minInfoPt: 8,
  /**
   * "Strip tiang rak" on A4 portrait (210 x 297 mm): the Per sel cell layout made compact, 95 mm
   * wide, two uprights side by side, all five levels on one sheet, no arrows.
   * 5 + 95 + 10 + 95 + 5 = 210 across; 5 x 57 = 285 down, centred (6 mm top and bottom). QR 22 mm with Code 128 (31 mm
   * without), still with the 3 mm quiet zone; the bin code stays >= minBinCodePt in an 11 mm band.
   */
  a4: { stripWidthMm: 95, gapMm: 10, marginMm: 5, cellHeightMm: 57, levelsPerSheet: 5, levels: 5,
        qrMm: 31, qrWithCode128Mm: 22, code128Mm: 7, bandMm: 11 },
};

/**
 * "Kartu palet" from a Form Checker upload (/labels/pallet): one A4 LANDSCAPE page per pallet
 * row, big enough to read from the floor with the item stacked up high. Sizes in mm and pt.
 * A4 landscape (297 x 210) puts the item code wider across the page; font sizes below keep
 * every card field on one page.
 */
export const PALLET_CARD = {
  pageWidthMm: 297,
  pageHeightMm: 210,
  marginMm: 12,
  labelPt: 10,     // small gray field labels
  skuPt: 140,      // item code — owner tuned 108 → 115 → 130 → 135 → 140; the shrink loop keeps 9 digits inside the sheet
  qtyPt: 96,       // quantity value, printed without a label — owner: as big as the LOCATION/bin value
  uomPt: 28,       // UoM beside the qty
  locationPt: 96,  // LOCATION value — big for reading from the floor
  batchPt: 64,     // Batch No. value — the thing a checker scans for from afar
  detailPt: 12,    // optional detail strip (exp/mfg/GR/putaway in one gray line)
};

export type BinParts = { zone: string; rack: string | null; level: string | null; position: string | null };

/** Split a bin code into its parts. Returns null when the code is not recognised. */
export function parseBinCode(raw: string): (BinParts & { code: string; kind: "rack" | "floor" }) | null {
  const code = raw.trim().toUpperCase();
  const m = code.match(RACK_BIN_REGEX);
  if (m) return { code, kind: "rack", zone: m[1], rack: m[2], level: m[3], position: m[4] };
  if (code in FLOOR_LOCATIONS) return { code, kind: "floor", zone: FLOOR_LOCATIONS[code].zone, rack: null, level: null, position: null };
  const s = code.match(STAGING_LANE_REGEX);
  if (s) return { code, kind: "floor", zone: "STAGING", rack: null, level: null, position: s[1] };
  const si = code.match(STAGING_INB_LANE_REGEX);
  if (si) return { code, kind: "floor", zone: "STAGING", rack: null, level: null, position: si[1] };
  const c = code.match(BLOCK_C_SLOT_REGEX);
  if (c) return { code, kind: "floor", zone: c[1], rack: null, level: null, position: c[2] };
  return null;
}

export type ExpiryStatus = "expired" | "near" | "ok" | "unknown";

export function daysUntil(dateIso: string | null | undefined, today = new Date()): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

export function expiryStatus(dateIso: string | null | undefined): ExpiryStatus {
  const days = daysUntil(dateIso);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= NEAR_EXPIRY_DAYS) return "near";
  return "ok";
}

/**
 * The one-time welcome screen with the credits (components/app/welcome-screen.tsx). false turns it
 * off on every device, e.g. if it gets in the way on warehouse handhelds. The Kredit link still works.
 */
export const SHOW_WELCOME = true;
