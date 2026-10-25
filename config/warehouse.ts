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

/**
 * Aisles kept out of our rack-occupancy metric: the CKB 3PL area (physically
 * confirmed 21 Oct 2026, reopened by 0086). Those bins are booked to the
 * consignee, so filling them is not our warehouse filling up.
 */
export const OCCUPANCY_EXCLUDED_ZONES = ["CG", "CH"];

/** Non-rack locations present in the sheet. They are imported as floor bins. */
export const FLOOR_LOCATIONS: Record<string, { zone: string; status: "active" | "blocked" }> = {
  STAGING: { zone: "STAGING", status: "active" },
  QUARANTINE: { zone: "QUARANTINE", status: "blocked" },
};
export const STAGING_LANE_REGEX = /^STG_(\d{2})$/;

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
  qtyPt: 64,       // quantity value, printed without a label — same size as the batch no
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
