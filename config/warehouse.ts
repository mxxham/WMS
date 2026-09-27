/**
 * Static configuration for WSM SUB 2. Values marked CONFIRM are assumptions
 * that must be checked against the physical warehouse before go-live.
 */
export const WAREHOUSE_NAME = "PT Cipta Krida Bahari · WSM SUB 2 Surabaya";

/** Stock expiring within this many days is shown yellow (FEFO warning). */
export const NEAR_EXPIRY_DAYS = 90;

/** Bin code format found in the WMS sheet: Aisle(2) Rack(2) Level(1) Position(2), e.g. CA01C01. */
export const RACK_BIN_REGEX = /^(C[A-Z])(\d{2})([A-E])(\d{2})$/;

/** Non-rack locations present in the sheet. They are imported as floor bins. */
export const FLOOR_LOCATIONS: Record<string, { zone: string; status: "active" | "blocked" }> = {
  STAGING: { zone: "STAGING", status: "active" },
  QUARANTINE: { zone: "QUARANTINE", status: "blocked" },
};
export const STAGING_LANE_REGEX = /^STG_(\d{2})$/;

/**
 * Level colours for the rack-upright label, following the reference photo
 * (first cell = red ... last cell = blue). One cell per level.
 */
export const LEVEL_COLORS: Record<string, { hex: string; name: string }> = {
  A: { hex: "#D7263D", name: "Merah" },
  B: { hex: "#F07C1B", name: "Oranye" },
  C: { hex: "#F6E21B", name: "Kuning" },
  D: { hex: "#3FA34D", name: "Hijau" },
  E: { hex: "#3C8DDE", name: "Biru" },
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
