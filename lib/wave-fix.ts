import type { AllocatorConfig } from "./allocator/config";
import { selectNextBin, toLedger } from "./allocator/binselect";
import { parseLocation } from "./allocator/pickpath";
import type { StockBin } from "./allocator/types";

/**
 * "Perbaiki" on a stok kurang row: propose the smallest change that makes an
 * open pick (and its Bin To Bin) doable from the stock as it is now. Pure — the
 * wave page loads the SKU's stock and the other open rows, shows the proposal
 * in one sentence and saves it through edit_pick_row (0052) only on confirm.
 *
 * Free stock of a bin + SKU + batch + expiry = physical − what other open rows
 * take from it + what other open moves bring into it (task_shortfalls' own
 * rule, 0007), so a proposal never takes stock another row needs and the row
 * is no longer flagged once saved.
 *   1. Its own bin still covers the pick: keep it; only shrink (or drop) the
 *      Bin To Bin to what is really left after the pick.
 *   2. Otherwise move the whole pick to another bin, chosen by selectNextBin —
 *      the engine's one bin-choice rule (FEFO, then pallet rules) — first among
 *      bins holding the same batch + expiry (stock that was moved, e.g. into a
 *      pickface), then among all. A later expiry is flagged, never silent.
 *   3. Nothing anywhere covers it: say so; Batal is the honest answer.
 */

export type FixStock = { bin: string; batch: string; expiry: string | null; qty: number; blocked: boolean };
export type FixClaim = { from: string; to: string | null; batch: string; expiry: string | null; qty: number };
export type FixRow = { from: string; sku: string; batch: string; expiry: string | null; qty: number; upp: number };
export type FixMove = { to: string; qty: number };

export type FixProposal =
  | { kind: "ok"; sentence: string }
  | { kind: "none"; sentence: string }
  | { kind: "resize"; from: string; batch: string; expiry: string | null; moveTo: string | null; moveQty: number | null; sentence: string }
  | { kind: "repoint"; from: string; batch: string; expiry: string | null; moveTo: string | null; moveQty: number | null; fefoLater: boolean; sentence: string };

const key = (bin: string, batch: string, expiry: string | null) => `${bin}|${batch}|${expiry ?? ""}`;
const n = (x: number) => x.toLocaleString("id-ID");

/** Free stock per identity: physical − other rows' takes + other moves' arrivals (claims exclude this row and its move). */
export function freeStock(stock: FixStock[], claims: FixClaim[]): Map<string, number> {
  const free = new Map<string, number>();
  for (const s of stock) free.set(key(s.bin, s.batch, s.expiry), (free.get(key(s.bin, s.batch, s.expiry)) ?? 0) + Number(s.qty));
  for (const c of claims) {
    const out = key(c.from, c.batch, c.expiry);
    free.set(out, (free.get(out) ?? 0) - Number(c.qty));
    if (c.to) { const inn = key(c.to, c.batch, c.expiry); free.set(inn, (free.get(inn) ?? 0) + Number(c.qty)); }
  }
  return free;
}

export function proposeFix(pick: FixRow, move: FixMove | null, stock: FixStock[], claims: FixClaim[], config: AllocatorConfig): FixProposal {
  const free = freeStock(stock, claims);
  const own = free.get(key(pick.from, pick.batch, pick.expiry)) ?? 0;

  // 1. The bin still covers the pick: only the Bin To Bin can be wrong.
  if (own >= pick.qty) {
    const left = own - pick.qty;
    if (!move || move.qty <= left) return { kind: "ok", sentence: `${pick.from} cukup untuk pick ini (bebas ${n(own)}); tidak ada yang perlu diubah.` };
    return left > 0
      ? { kind: "resize", from: pick.from, batch: pick.batch, expiry: pick.expiry, moveTo: move.to, moveQty: left,
          sentence: `Tetap ambil ${n(pick.qty)} dari ${pick.from}; sisa palet yang dipindah ke ${move.to} jadi ${n(left)} (bukan ${n(move.qty)}), karena hanya itu yang tersisa setelah pick.` }
      : { kind: "resize", from: pick.from, batch: pick.batch, expiry: pick.expiry, moveTo: null, moveQty: null,
          sentence: `Tetap ambil ${n(pick.qty)} dari ${pick.from}; Bin To Bin ke ${move.to} dihapus, karena tidak ada sisa setelah pick.` };
  }

  // 2. Another bin, chosen by the engine's own rule.
  const seen = new Set<string>();
  const pool = stock.flatMap((s): StockBin[] => {
    const k = key(s.bin, s.batch, s.expiry);
    const qty = free.get(k) ?? 0;
    const p = parseLocation(s.bin);
    // Only stock physically on the shelf: edit_pick_row refuses a bin whose cartons have not arrived.
    if (seen.has(k) || qty <= 0 || Number(s.qty) <= 0 || s.blocked || !p || !config.rackLocationPattern.test(s.bin)
      || config.blockedBins.includes(s.bin) || k === key(pick.from, pick.batch, pick.expiry)) return [];
    seen.add(k);
    return [{
      binId: k, location: s.bin, aisle: p.aisle, bay: p.bay, level: p.level, position: p.position, sku: pick.sku, description: "",
      batch: s.batch || null, expiryDate: new Date(`${s.expiry ?? "9999-12-31"}T00:00:00Z`), grDate: null,
      qtyCartons: qty, upp: pick.upp, uom: null, isFullPallet: qty === pick.upp,
    }];
  });
  const covers = (b: StockBin) => b.qtyCartons >= pick.qty;
  const pickFrom = (bins: StockBin[]) => selectNextBin(bins.map((b) => toLedger(b, config)), pick.qty, pick.upp, config)?.bin;
  const sameStock = pool.filter((b) => (b.batch ?? "") === pick.batch && b.expiryDate.toISOString().slice(0, 10) === (pick.expiry ?? "9999-12-31") && covers(b));
  const chosen = pickFrom(sameStock) ?? pickFrom(pool.filter(covers));
  if (!chosen) {
    const total = pool.reduce((a, b) => a + b.qtyCartons, 0) + Math.max(own, 0);
    return { kind: "none", sentence: total > 0
      ? `Tidak ada satu bin pun dengan ${n(pick.qty)} bebas (total bebas SKU ini ${n(total)}). Pecah tugasnya, atau Batal bila stok memang tidak ada.`
      : `Tidak ada stok bebas SKU ini di bin mana pun. Batal tugas ini (order jadi kurang), atau koreksi stok dulu bila barangnya ada.` };
  }
  const exp = chosen.expiryDate.toISOString().slice(0, 10);
  const fefoLater = exp > (pick.expiry ?? "9999-12-31");
  // A sealed pallet opened for a loose pick keeps its rest where the old move sent it, if there was one.
  const opens = chosen.isFullPallet && pick.qty < pick.upp;
  const keepMove = !!move && opens && move.to !== chosen.location && chosen.qtyCartons - pick.qty > 0;
  const moveQty = keepMove ? chosen.qtyCartons - pick.qty : null;
  return {
    kind: "repoint", from: chosen.location, batch: chosen.batch ?? "", expiry: exp === "9999-12-31" ? null : exp,
    moveTo: keepMove ? move!.to : null, moveQty, fefoLater,
    sentence: `Ambil ${n(pick.qty)} dari ${chosen.location} (batch ${chosen.batch || "–"}, exp ${exp}, bebas ${n(chosen.qtyCartons)})`
      + ` bukan ${pick.from} (bebas ${n(Math.max(own, 0))})`
      + (keepMove ? `; buka palet, sisa ${n(moveQty!)} ke ${move!.to}` : move ? `; Bin To Bin ke ${move.to} dihapus` : "")
      + (fefoLater ? `. FEFO dilewati: exp lebih lama dari rencana ${pick.expiry}.` : "."),
  };
}
