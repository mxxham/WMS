import { addDays, jakartaDay } from "./ledger/dates";

/**
 * "Karton masuk" on the dashboard and home: the cartons that ARRIVED on a day.
 *
 * The team posts a day's putaway the next morning (the sheet is finished at night), choosing the
 * arrival date on the putaway page (0117, putaway_arrival_moves). A putaway with an arrival date
 * counts on that date; anything else (receipts, putaways before 0117) on the day it was posted.
 */
export type InflowMove = {
  type: string;
  quantity: number;
  from_bin_id: string | null;
  created_at: string;
  // PostgREST embeds the one-to-one row as an object; tolerate an array too.
  putaway_arrival_moves?: { arrival_date: string } | { arrival_date: string }[] | null;
};

/** The select for `movements` that feeds `flowOnDay`. */
export const INFLOW_SELECT = "type, quantity, from_bin_id, created_at, putaway_arrival_moves(arrival_date)";

/** An arrival is at most 7 days before its posting (the putaway page's limit), so fetch from here. */
export function inflowFetchSince(day: string): string {
  return new Date(`${addDays(day, -7)}T00:00:00+07:00`).toISOString();
}

/** The Jakarta day a movement counts on. */
export function inflowDay(m: InflowMove): string {
  const a = Array.isArray(m.putaway_arrival_moves) ? m.putaway_arrival_moves[0] : m.putaway_arrival_moves;
  return a?.arrival_date ?? jakartaDay(new Date(m.created_at));
}

/** In = new receipts (inbound, putaway without a source bin) that arrived on `day`; out = picking posted on `day`. */
export function flowOnDay(moves: InflowMove[], day: string): { masuk: number; keluar: number } {
  const flow = { masuk: 0, keluar: 0 };
  for (const m of moves) {
    if (m.type === "picking") {
      if (jakartaDay(new Date(m.created_at)) === day) flow.keluar += Number(m.quantity);
    } else if ((m.type === "inbound" || !m.from_bin_id) && inflowDay(m) === day) {
      flow.masuk += Number(m.quantity);
    }
  }
  return flow;
}
