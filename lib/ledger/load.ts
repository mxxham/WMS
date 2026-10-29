import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import type { SapBookLine } from "./sap-book";
import { chainBreaks, compareDay, type LedgerLine, type LedgerNote, type LedgerSummary, type WmsBookLine } from "./compare";
import { addDays, isWaiting, jakartaDay, monthDays } from "./dates";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** One uploaded version of a day (ledger_latest_days, 0116). */
export type LedgerDayRow = {
  id: string; ledger_date: string; version: number; file_name: string; mb51_count: number; inbd_total: number;
  by_name: string | null; created_at: string;
};
export type LedgerDay = {
  date: string; day: LedgerDayRow | null; lines: LedgerLine[]; summary: LedgerSummary;
  /** SKUs whose SAP awal is not the previous day's MB52 */
  chain: string[]; previousUploaded: boolean; waiting: boolean;
};
export type LedgerMonthRow = {
  date: string; version: number; byName: string | null; createdAt: string;
  accuracy: number | null; qtyAccuracy: number | null; differing: number; skus: number; waiting: boolean;
};

const SAP_QTY = ["awal_unrest", "awal_block", "inbound", "outbound", "mv343", "mv344", "z55", "other_unrest", "akhir_unrest", "akhir_block", "inbd"];
const WMS_QTY = ["awal_unrest", "awal_block", "inbound", "inbound_block", "inbound_assumed", "outbound", "q_in", "q_out",
  "other_unrest", "other_block", "akhir_unrest", "akhir_block"];
/** PostgREST may send numeric columns as strings; arithmetic needs numbers. Only the quantity columns are touched. */
const num = (r: Record<string, unknown>, keys: string[]) => {
  const out = { ...r };
  for (const k of keys) out[k] = Number(r[k] ?? 0);
  return out;
};

async function latestDay(supabase: Supabase, date: string): Promise<LedgerDayRow | null> {
  const { data, error } = await supabase.from("ledger_latest_days").select("*").eq("ledger_date", date).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LedgerDayRow | null) ?? null;
}

async function sapLines(supabase: Supabase, dayId: string): Promise<SapBookLine[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) =>
    supabase.from("ledger_sap_lines").select("*").eq("day_id", dayId).order("sku").range(a, b) as unknown as Res);
  return rows.map((r) => num(r, SAP_QTY) as unknown as SapBookLine);
}

async function wmsBook(supabase: Supabase, date: string): Promise<WmsBookLine[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) =>
    supabase.rpc("ledger_wms_book", { p_date: date }).range(a, b) as unknown as Res);
  return rows.map((r) => num(r, WMS_QTY) as unknown as WmsBookLine);
}

/** Litres per carton / article by SKU (items.volume_l); null when not set. */
async function volumes(supabase: Supabase): Promise<Map<string, number | null>> {
  const rows = await fetchAll<{ sku: string; volume_l: number | string | null }>((a, b) =>
    supabase.from("items").select("sku, volume_l").order("sku").range(a, b) as unknown as Res);
  return new Map(rows.map((r) => [r.sku, r.volume_l === null ? null : Number(r.volume_l)]));
}

async function notesUntil(supabase: Supabase, date: string): Promise<LedgerNote[]> {
  return fetchAll<LedgerNote>((a, b) =>
    supabase.from("ledger_notes").select("*").lte("from_date", date).order("created_at").range(a, b) as unknown as Res);
}

/** One day of Buku stok: the latest SAP upload of `date` against the live WMS book. */
export async function loadLedgerDay(supabase: Supabase, date: string): Promise<LedgerDay> {
  const [day, prev, vol, notes, wms] = await Promise.all([
    latestDay(supabase, date), latestDay(supabase, addDays(date, -1)), volumes(supabase), notesUntil(supabase, date), wmsBook(supabase, date),
  ]);
  const [sap, prevSap] = await Promise.all([
    day ? sapLines(supabase, day.id) : Promise.resolve([] as SapBookLine[]),
    prev ? sapLines(supabase, prev.id) : Promise.resolve(null),
  ]);
  const { lines, summary } = compareDay(sap, wms, vol, notes, date);
  return {
    date, day, lines, summary, chain: day ? chainBreaks(sap, prevSap) : [], previousUploaded: !!prev,
    waiting: isWaiting(date, jakartaDay()),
  };
}

/** The uploaded days of a "YYYY-MM" month, newest first, each with its accuracy against the live WMS book. */
export async function loadLedgerMonth(supabase: Supabase, month: string): Promise<LedgerMonthRow[]> {
  const days = monthDays(month);
  const { data, error } = await supabase.from("ledger_latest_days").select("*")
    .gte("ledger_date", days[0]).lte("ledger_date", days[days.length - 1]).order("ledger_date", { ascending: false });
  if (error) throw new Error(error.message);
  const uploaded = (data ?? []) as LedgerDayRow[];
  if (!uploaded.length) return [];
  const [vol, notes] = await Promise.all([volumes(supabase), notesUntil(supabase, days[days.length - 1])]);
  const today = jakartaDay();
  const one = async (d: LedgerDayRow): Promise<LedgerMonthRow> => {
    const [sap, wms] = await Promise.all([sapLines(supabase, d.id), wmsBook(supabase, d.ledger_date)]);
    const { summary } = compareDay(sap, wms, vol, notes, d.ledger_date);
    return {
      date: d.ledger_date, version: d.version, byName: d.by_name, createdAt: d.created_at,
      accuracy: summary.accuracy, qtyAccuracy: summary.qtyAccuracy, differing: summary.differing, skus: summary.skus, waiting: isWaiting(d.ledger_date, today),
    };
  };
  // Every day runs ledger_wms_book; a few at a time keeps a month (up to 31) from landing on the database at once.
  const out: LedgerMonthRow[] = [];
  for (let i = 0; i < uploaded.length; i += 4) out.push(...await Promise.all(uploaded.slice(i, i + 4).map(one)));
  return out;
}
