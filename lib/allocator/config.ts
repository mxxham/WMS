/**
 * Every business rule the allocator obeys lives here. Change a value, change
 * the behaviour — no rule is hardcoded inside the engine.
 */
export interface AllocatorConfig {
  /** Date the allocation is run for (shelf-life and aging are measured from this). */
  asOf: Date;

  // ---- FEFO / shelf life -------------------------------------------------
  /** Refuse stock with fewer than this many days of life left at asOf. */
  minRemainingShelfLifeDays: number;
  /** Per-SKU override of minRemainingShelfLifeDays (item master, min_dispatch_days). */
  minRemainingShelfLifeDaysBySku: Record<string, number>;
  /** Flag (but still pick) stock below this many days. */
  nearExpiryWarningDays: number;
  /** Warn when one demand line ends up spanning more than one expiry date. */
  warnOnMixedExpiryPerLine: boolean;

  // ---- Pallet handling ---------------------------------------------------
  /**
   * For the loose remainder (qty % upp), pick from an already-opened bin
   * before breaking a sealed pallet. Applied inside the earliest-expiry group
   * only, so FEFO is never violated.
   */
  preferOpenPalletForRemainder: boolean;
  /**
   * Best-fit: among open bins of the earliest expiry, take the smallest one
   * that can still cover the need — clears fragments out of the rack.
   */
  bestFitOpenPallets: boolean;

  // ---- Location eligibility ---------------------------------------------
  /** Only locations matching this are pickable (rack bins). */
  rackLocationPattern: RegExp;
  /** Locations excluded even if they match the pattern. */
  excludedLocations: string[];
  /**
   * Outbound staging — stock here is already out of the rack. It covers what
   * the rack bins cannot (see allocator.ts), as a hand pick.
   */
  stagingLocations: string[];
  /** Floor staging lanes (STG_01..), treated like stagingLocations. */
  stagingLanePattern: RegExp;
  /** Bin statuses that are pickable. */
  pickableStatuses: string[];
  /** Specific bins on hold (cycle count, damage, blocked). */
  blockedBins: string[];

  // ---- Pick path ---------------------------------------------------------
  /** Walking order of aisles. */
  aisleSequence: string[];
  /**
   * Bays per face of a back-to-back rack block (WSM SUB 2: 20). Bay 21 is
   * directly behind bay 01. 0 = each aisle is one single-sided row.
   */
  baysPerSide: number;
  /** Reverse bay direction on every second aisle (no empty walk back). */
  serpentine: boolean;
  /** Ground level first within a bay. */
  levelSequence: string[];

  // ---- Task shaping ------------------------------------------------------
  /** Emit forklift (pallet) and handpick (case) work as separate picklists. */
  splitPalletAndCaseTasks: boolean;
  /** Split a picklist that exceeds this many lines (0 = never). */
  maxLinesPerPicklist: number;
  /** Order shipments by slot time, then shipment number. */
  sequenceShipmentsBySlot: boolean;

  // ---- Pickface replenishment ---------------------------------------------
  /**
   * Which rack levels are eligible for pickface assignment.
   * Only bins with a level in this list will be auto-derived as pickfaces.
   * Default: ['A'] — only ground floor (Level A) bins are pickfaces.
   * Levels B-E are always bulk/reserve stock.
   */
  pickfaceLevels: string[];
  /**
   * Bins reserved as a SKU's dedicated outbound pickface don't get auto-derived
   * or drawn from as a replenishment source. Keyed by SKU when set by an admin.
   */
  pickfaceOverrides: Record<string, string>;
  /**
   * Top a pickface up to this many cartons (a full pallet's worth by default —
   * pass a number to override every SKU, or leave 'upp' to use each SKU's own
   * pallet size).
   */
  pickfaceTargetQty: number | 'upp';

  // ---- Relocation event ordering -------------------------------------------
  /**
   * Determines the order in which pallet-break / relocation-to-pickface events
   * are assigned when a bulk bin is split across multiple waves.
   *
   * - 'picklistNumber' (default): the lowest-numbered picklist/wave owns the
   *   break event, matching the order pickers actually work in.
   * - 'allocationOrder': the allocator's internal demand-processing order
   *   determines which wave owns the break (legacy behaviour).
   */
  relocationOrderBasis: 'picklistNumber' | 'allocationOrder';
}

export const DEFAULT_CONFIG: AllocatorConfig = {
  asOf: new Date(),

  minRemainingShelfLifeDays: 0,
  minRemainingShelfLifeDaysBySku: {},
  nearExpiryWarningDays: 365,
  warnOnMixedExpiryPerLine: true,

  preferOpenPalletForRemainder: true,
  bestFitOpenPallets: true,

  // CA01A01 → aisle CA, bay 01, level A, position 01. Racks stop at CF: aisle CG
  // is only template rows in the WMS sheet (400, all empty), confirmed 5 Oct 2026.
  rackLocationPattern: /^C[A-F]\d{2}[A-E]\d{2}$/,
  excludedLocations: ['STAGING', 'STAGING_INB', 'STAGING_OUT', 'Quarantine', 'QUARANTINE'],
  stagingLocations: ['STAGING', 'STAGING_OUT'],
  stagingLanePattern: /^STG_\d{2}$/,
  pickableStatuses: ['Aktif', 'AKTIF', 'ACTIVE'],
  /**
   * Phantom racks confirmed non-existent on the floor (tiang/pilar):
   * full CE33 row + CE32 position 02 + CE34 position 01.
   * DB rows deleted; listed here so the engine never picks from
   * nor relocates (bin-to-bin) into these codes, whatever the stock source.
   */
  blockedBins: [
    'CE33A01', 'CE33A02', 'CE33B01', 'CE33B02', 'CE33C01',
    'CE33C02', 'CE33D01', 'CE33D02', 'CE33E01', 'CE33E02',
    'CE32A02', 'CE32B02', 'CE32C02', 'CE32D02', 'CE32E02',
    'CE34A01', 'CE34B01', 'CE34C01', 'CE34D01', 'CE34E01',
  ],

  aisleSequence: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG'],
  baysPerSide: 20,
  serpentine: true,
  levelSequence: ['A', 'B', 'C', 'D', 'E'],

  splitPalletAndCaseTasks: true,
  maxLinesPerPicklist: 0,
  sequenceShipmentsBySlot: true,

  pickfaceLevels: ['A'],
  pickfaceOverrides: {},
  pickfaceTargetQty: 'upp',

  relocationOrderBasis: 'picklistNumber',
};

export function withConfig(overrides: Partial<AllocatorConfig> = {}): AllocatorConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export const MS_PER_DAY = 86_400_000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function isStagingLocation(location: string, config: AllocatorConfig): boolean {
  const loc = location.trim().toUpperCase();
  return config.stagingLocations.some((x) => loc === x.toUpperCase()) || config.stagingLanePattern.test(loc);
}

/**
 * Stand-in expiry for staging stock the WMS sheet lists without one. It sorts
 * after every real date and prints as "-" (expiryText).
 */
export const NO_EXPIRY = new Date(Date.UTC(9999, 11, 31));

/** Minimum days of life left for a SKU to be dispatched. */
export function minShelfLifeDays(sku: string, config: AllocatorConfig): number {
  return config.minRemainingShelfLifeDaysBySku?.[sku] ?? config.minRemainingShelfLifeDays;
}

export function hasExpiry(d: Date): boolean {
  return d.getTime() !== NO_EXPIRY.getTime();
}

/** 'YYYY-MM-DD', or '-' for NO_EXPIRY. */
export function expiryText(d: Date): string {
  return hasExpiry(d) ? d.toISOString().slice(0, 10) : '-';
}
