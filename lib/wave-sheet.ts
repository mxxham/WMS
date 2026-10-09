import { pairMoves } from "./allocator/pair-moves";
import type { TaskRow } from "./allocator/picklist-from-tasks";

/**
 * "Isi dari picklist" (0057): a wave as an editable copy of its printed
 * picklist. Each line starts as the plan (or, once posted, as it was posted);
 * the supervisor types what the paper says, ticks each line once checked
 * against the paper, and post_wave_sheet posts the ticked lines in one
 * transaction. Nothing here refuses what the floor did: odd
 * choices are warnings, and a source the system says is short is corrected
 * by the database (koreksi picklist + count). Only a bin that does not exist
 * is an error.
 */

/** One source of a line as typed: strings, because they are inputs. */
export type SheetSource = { bin: string; batch: string; expiry: string; qty: string };

export type SheetLine = {
  key: string;
  seq: number;
  sku: string;
  description: string;
  uom: string | null;
  shipment: string | null;
  pick: TaskRow | null;
  move: TaskRow | null;
  /** Already posted: changed only when the paper differs. */
  posted: boolean;
  /** An open line: ticked when checked against the paper — only ticked lines post. Starts unticked. */
  done: boolean;
  sources: SheetSource[];
  moveTo: string;
  moveQty: string;
};

/** One stock line, as inventory_detail lists it. */
export type SheetStock = { bin: string; sku: string; batch: string; expiry: string | null; qty: number };

export type SheetNote = { tone: "bad" | "warn" | "info"; text: string };

/** An open Bin To Bin of any open wave: the database posts it first when the paper takes from its destination. */
export type SheetIncoming = { id: string; to: string; sku: string; batch: string; expiry: string | null; qty: number; label: string };

const day = (d: string | null | undefined) => (d ?? "").slice(0, 10);
const up = (s: string) => s.trim().toUpperCase();
const stockKey = (bin: string, sku: string, batch: string, expiry: string) => `${up(bin)}|${sku}|${batch.trim()}|${day(expiry)}`;
const normBatch = (b: string) => b.replace(/\s/g, "").toUpperCase();

/**
 * The stock line a paper source really takes (0061 sheet_real_batch): the
 * paper's batch when the bin holds it (or a Bin To Bin brings it), else the
 * same batch under another expiry, else the bin's earliest-expiry batch of the
 * SKU. A bin without the SKU keeps the paper's batch (koreksi picklist).
 */
function realBatch(have: Map<string, number>, bin: string, sku: string, batch: string, expiry: string, incoming: boolean) {
  const k = stockKey(bin, sku, batch, expiry);
  if ((have.get(k) ?? 0) > 0 || incoming) return null;
  const prefix = `${up(bin)}|${sku}|`;
  const lines = [...have.entries()].filter(([key, q]) => key.startsWith(prefix) && q > 0).map(([key, q]) => {
    const [, , b, e] = key.split("|");
    return { key, batch: b, expiry: e, qty: q };
  });
  lines.sort((a, b) => Number(normBatch(b.batch) === normBatch(batch)) - Number(normBatch(a.batch) === normBatch(batch))
    || (a.expiry || "9999").localeCompare(b.expiry || "9999") || b.qty - a.qty || a.batch.localeCompare(b.batch));
  return lines[0] ?? null;
}

/** What the line says now, in the form the database compares. */
function shape(l: Pick<SheetLine, "sources" | "moveTo" | "moveQty">) {
  return JSON.stringify({
    s: l.sources.map((s) => [up(s.bin), s.batch.trim(), day(s.expiry), Number(s.qty) || 0]),
    to: up(l.moveTo), mq: up(l.moveTo) ? Number(l.moveQty) || 0 : 0,
  });
}

function lineOf(pick: TaskRow | null, move: TaskRow | null): SheetLine {
  const head = (pick ?? move)!;
  const done = (t: TaskRow) => t.status === "COMPLETED";
  const src = (t: TaskRow, qty: string): SheetSource => done(t)
    ? { bin: t.actual_from_bin ?? t.from_bin, batch: t.actual_batch_lot ?? t.batch_lot, expiry: day(t.actual_expiry_date ?? t.expiry_date), qty }
    : { bin: t.from_bin, batch: t.batch_lot, expiry: day(t.expiry_date), qty };
  const qtyOf = (t: TaskRow) => String(Number(done(t) ? t.actual_quantity ?? t.quantity : t.quantity));
  return {
    key: head.id, seq: head.seq, sku: head.sku, description: head.description, uom: head.uom, shipment: pick?.shipment_number ?? null,
    pick, move, posted: done(head), done: false,
    sources: [pick ? src(pick, qtyOf(pick)) : src(move!, "")],
    moveTo: move?.to_bin ?? "", moveQty: move ? qtyOf(move) : "",
  };
}

/**
 * The wave's lines in picklist order (a broken pallet's pick and its move are
 * one line, pairMoves), and its cancelled tasks apart.
 */
export function buildSheet(tasks: TaskRow[]): { lines: SheetLine[]; cancelled: TaskRow[] } {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const lines = pairMoves(live).map((it) => it.kind === "pair" ? lineOf(it.pick, it.move)
    : it.task.task_type === "PICK" ? lineOf(it.task, null) : lineOf(null, it.task));
  return { lines, cancelled: tasks.filter((t) => t.status === "CANCELLED").sort((a, b) => a.seq - b.seq) };
}

export const lineChanged = (l: SheetLine, initial: SheetLine) => shape(l) !== shape(initial);

/** The post_wave_sheet payload: open lines marked done, and posted lines whose paper differs. */
export function sheetPayload(lines: SheetLine[], initial: Map<string, SheetLine>) {
  return lines.filter((l) => (l.posted ? lineChanged(l, initial.get(l.key)!) : l.done)).map((l) => {
    const to = up(l.moveTo);
    const sources = l.sources.filter((s, i) => i === 0 || up(s.bin) !== "" || Number(s.qty) > 0);
    return {
      pick_id: l.pick?.id ?? null,
      move_id: l.move?.id ?? null,
      sources: sources.map((s) => ({ bin: up(s.bin), batch: s.batch.trim(), expiry: day(s.expiry) || null, qty: l.pick ? Number(s.qty) || 0 : 0 })),
      move_to: to || null,
      move_qty: to ? Number(l.moveQty) || 0 : null,
    };
  });
}

/**
 * Notes per line, replaying the lines in picklist order against the stock
 * the system has now: what the paper takes beyond it is shown as the
 * correction the database will book. `bins` (when loaded) catches typos.
 */
export function sheetNotes(lines: SheetLine[], initial: Map<string, SheetLine>, stock: SheetStock[], bins: Set<string> | null,
  incoming: SheetIncoming[] = []): Map<string, SheetNote[]> {
  const have = new Map<string, number>();
  for (const s of stock) have.set(stockKey(s.bin, s.sku, s.batch, s.expiry ?? ""), (have.get(stockKey(s.bin, s.sku, s.batch, s.expiry ?? "")) ?? 0) + s.qty);
  const get = (k: string) => have.get(k) ?? 0;
  const out = new Map<string, SheetNote[]>();
  // Moves this sheet posts itself are replayed with their lines, never counted twice.
  const own = new Set(lines.flatMap((l) => (l.move ? [l.move.id] : [])));
  const waiting = incoming.filter((m) => !own.has(m.id));
  const used = new Set<string>();
  // Open Bin To Bins further down this sheet that the database posts early, as planned, to fill a bin a line above needs.
  const early = new Map<string, { from: string; to: string; qty: number }>();

  for (const [idx, l] of lines.entries()) {
    const notes: SheetNote[] = [];
    const init = initial.get(l.key)!;
    const changed = lineChanged(l, init);
    const sending = l.posted ? changed : l.done;
    const plan = l.pick ?? l.move!;
    const first = l.sources[0];

    // Typos and impossible values: the only things the database refuses.
    const binsUsed = [...l.sources.filter((s, i) => i === 0 || up(s.bin) || Number(s.qty) > 0).map((s) => up(s.bin)), ...(up(l.moveTo) ? [up(l.moveTo)] : [])];
    for (const b of binsUsed) {
      if (!b) notes.push({ tone: "bad", text: "Isi kode bin." });
      else if (bins && !bins.has(b)) notes.push({ tone: "bad", text: `Bin ${b} tidak ada.` });
    }
    if (up(l.moveTo) && up(l.moveTo) === up(first.bin)) notes.push({ tone: "bad", text: "Bin To Bin ke bin yang sama." });
    for (const s of l.pick ? l.sources : []) {
      const q = Number(s.qty);
      if (s.qty.trim() !== "" && (!Number.isInteger(q) || q < 0)) notes.push({ tone: "bad", text: `Jumlah "${s.qty}" tidak valid.` });
    }
    if (up(l.moveTo) && !(Number(l.moveQty) > 0)) notes.push({ tone: "bad", text: "Isi jumlah sisa Bin To Bin, atau kosongkan tujuannya." });

    // What differs from the plan: allowed, shown.
    if (l.pick) {
      const total = l.sources.reduce((n, s) => n + (Number(s.qty) || 0), 0);
      const planned = Number(l.pick.quantity);
      if (total > planned) notes.push({ tone: "warn", text: `Diambil ${total}, lebih dari rencana ${planned}.` });
      else if (total < planned) notes.push({ tone: "warn", text: `Diambil ${total} dari ${planned}: kurang ${planned - total}.` });
      if (l.sources.length > 1) notes.push({ tone: "info", text: `Dari ${l.sources.length} bin: baris dipecah.` });
    }
    if (up(first.bin) !== up(plan.from_bin)) notes.push({ tone: "warn", text: `Bin lain dari rencana ${plan.from_bin}.` });
    else if (first.batch.trim() !== plan.batch_lot) notes.push({ tone: "warn", text: `Batch lain dari rencana ${plan.batch_lot || "–"}.` });
    for (const s of l.sources) {
      if (day(s.expiry) && day(plan.expiry_date) && day(s.expiry) > day(plan.expiry_date)) {
        notes.push({ tone: "warn", text: `Tidak FEFO: exp ${day(s.expiry)} lebih lama dari rencana ${day(plan.expiry_date)}.` });
        break;
      }
    }
    const planTo = l.move?.to_bin ?? "";
    if (up(l.moveTo) !== up(planTo)) {
      notes.push({ tone: "info", text: !up(l.moveTo) ? `Sisa tidak dipindah (rencana ke ${planTo}).` : planTo ? `Bin To Bin ke ${up(l.moveTo)}, rencana ${planTo}.` : `Bin To Bin baru ke ${up(l.moveTo)}.` });
    } else if (l.move && up(l.moveTo) && Number(l.moveQty) !== Number(l.move.quantity)) {
      notes.push({ tone: "info", text: `Sisa ${l.moveQty}, rencana ${Number(l.move.quantity)}.` });
    }
    if (l.posted && changed) notes.push({ tone: "info", text: "Sudah diposting: dibatalkan lalu diposting ulang sesuai kertas." });

    // Replay against the stock: a posted line that is redone first gives back what it took.
    if (l.posted && changed) {
      const old = init.sources[0];
      if (l.pick) { const k = stockKey(old.bin, l.sku, old.batch, old.expiry); have.set(k, get(k) + Number(old.qty || 0)); }
      if (up(init.moveTo) && Number(init.moveQty) > 0) {
        const from = stockKey(old.bin, l.sku, old.batch, old.expiry), to = stockKey(init.moveTo, l.sku, old.batch, old.expiry);
        have.set(from, get(from) + Number(init.moveQty)); have.set(to, get(to) - Number(init.moveQty));
      }
    }
    if (sending) {
      // Its move went early, as planned: the line itself redoes it as the paper says.
      const went = early.get(l.key);
      if (went) { have.set(went.to, get(went.to) - went.qty); have.set(went.from, get(went.from) + went.qty); }
      let moveKey = stockKey(l.moveTo, l.sku, first.batch, first.expiry);
      l.sources.forEach((s, i) => {
        if (!up(s.bin)) return;
        let k = stockKey(s.bin, l.sku, s.batch, s.expiry);
        const take = (l.pick ? Number(s.qty) || 0 : 0) + (i === 0 && up(l.moveTo) ? Number(l.moveQty) || 0 : 0);
        if (take <= 0) return;
        // The cartons in the bin are what was taken: a batch the bin does not hold is read as the bin's own.
        if (l.pick && Number(s.qty) > 0) {
          const incoming = waiting.some((m) => !used.has(m.id) && stockKey(m.to, m.sku, m.batch, m.expiry ?? "") === k)
            || lines.slice(idx + 1).some((later) => later.move?.status === "PLANNED" && !!later.move.to_bin
              && stockKey(later.move.to_bin, later.sku, later.move.batch_lot, day(later.move.expiry_date)) === k);
          const real = realBatch(have, s.bin, l.sku, s.batch, s.expiry, incoming);
          if (real) {
            k = real.key;
            if (i === 0) moveKey = stockKey(l.moveTo, l.sku, real.batch, real.expiry);
            notes.push({ tone: "warn", text: `Batch ${s.batch.trim() || "–"}${day(s.expiry) ? ` exp ${day(s.expiry)}` : ""} tidak ada di ${up(s.bin)}: diambil dari batch ${real.batch || "–"} exp ${real.expiry || "–"} yang ada di bin (tidak ada stok baru).` });
          }
        }
        let h = get(k);
        for (const m of waiting) {
          if (h >= take) break;
          if (used.has(m.id) || stockKey(m.to, m.sku, m.batch, m.expiry ?? "") !== k) continue;
          used.add(m.id);
          h += m.qty;
          notes.push({ tone: "info", text: `${up(s.bin)} baru terisi lewat Bin To Bin ${m.label} (${m.qty}): ikut diposting dulu.` });
        }
        for (const later of lines.slice(idx + 1)) {
          if (h >= take) break;
          const mv = later.move;
          if (!mv || mv.status !== "PLANNED" || !mv.to_bin || early.has(later.key)) continue;
          const to = stockKey(mv.to_bin, later.sku, mv.batch_lot, day(mv.expiry_date));
          if (to !== k) continue;
          const from = stockKey(mv.from_bin, later.sku, mv.batch_lot, day(mv.expiry_date));
          const q = Number(mv.quantity);
          early.set(later.key, { from, to, qty: q });
          have.set(from, get(from) - q);
          h += q;
          notes.push({ tone: "info", text: `${up(s.bin)} baru terisi lewat Bin To Bin #${later.seq} di lembar ini (${q}): ikut diposting dulu.` });
        }
        // 0062: a Bin To Bin further down this paper that fills this bin (same SKU, any batch) is posted first.
        if (h < take) for (const later of lines.slice(idx + 1)) {
          if (early.has(later.key)) continue;
          const sends = later.posted ? lineChanged(later, initial.get(later.key)!) : later.done;
          const lf = later.sources[0];
          if (!sends || later.sku !== l.sku || up(later.moveTo) !== up(s.bin) || !(Number(later.moveQty) > 0) || !up(lf.bin)) continue;
          const from = stockKey(lf.bin, later.sku, lf.batch, lf.expiry), to = stockKey(later.moveTo, later.sku, lf.batch, lf.expiry);
          const q = Number(later.moveQty);
          early.set(later.key, { from, to, qty: q });
          have.set(from, get(from) - q);
          if (to === k) h += q; else have.set(to, get(to) + q);
          notes.push({ tone: "info", text: `Bin To Bin #${later.seq} di lembar ini membawa ${q} ke ${up(s.bin)}: diposting dulu, seperti di lantai.` });
        }
        // 0062: too few of this batch: the rest from the bin's other batches of the SKU, earliest expiry first.
        if (h < take && l.pick && !(i === 0 && up(l.moveTo))) {
          const prefix = `${up(s.bin)}|${l.sku}|`;
          const others = [...have.entries()].filter(([key, q]) => key !== k && key.startsWith(prefix) && q > 0)
            .map(([key, q]) => ({ key, batch: key.split("|")[2], expiry: key.split("|")[3], qty: q }))
            .sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999") || b.qty - a.qty || a.batch.localeCompare(b.batch));
          let need = take - Math.max(h, 0);
          for (const o of others) {
            if (need <= 0) break;
            const n = Math.min(need, o.qty);
            have.set(o.key, o.qty - n);
            need -= n;
            notes.push({ tone: "info", text: `${n} diambil dari batch ${o.batch || "–"} (exp ${o.expiry || "–"}) di ${up(s.bin)}: batch ${k.split("|")[2] || "–"} kurang.` });
          }
          const filled = take - Math.max(h, 0) - need;
          h = Math.max(h, 0) + filled;
        }
        if (h < take) notes.push({ tone: "warn", text: `Sistem: ${up(s.bin)} batch ${k.split("|")[2] || "–"} hanya ${Math.max(h, 0)}, kertas ${take}: +${take - Math.max(h, 0)} koreksi picklist (relokasi masuk yang terbuka diposting dulu), ${up(s.bin)} dihitung ulang.` });
        have.set(k, Math.max(h, take) - take);
      });
      if (up(l.moveTo) && Number(l.moveQty) > 0) have.set(moveKey, get(moveKey) + Number(l.moveQty));
    }
    // A posted line the paper agrees with needs no story, only errors.
    out.set(l.key, l.posted && !changed ? notes.filter((x) => x.tone === "bad") : notes);
  }
  return out;
}

/** One sentence per kind of change, for the confirmation step. */
export function sheetSummary(lines: SheetLine[], initial: Map<string, SheetLine>, notes: Map<string, SheetNote[]>) {
  const open = lines.filter((l) => !l.posted);
  const send = sheetPayload(lines, initial).length;
  const asPlanned = open.filter((l) => l.done && !lineChanged(l, initial.get(l.key)!)).length;
  const changed = open.filter((l) => l.done && lineChanged(l, initial.get(l.key)!)).length;
  const reposted = lines.filter((l) => l.posted && lineChanged(l, initial.get(l.key)!)).length;
  const left = open.filter((l) => !l.done).length;
  const all = [...notes.values()].flat();
  return {
    send, asPlanned, changed, reposted, left,
    errors: all.filter((n) => n.tone === "bad").length,
    corrections: all.filter((n) => n.text.includes("koreksi picklist")).length,
    fefo: all.filter((n) => n.text.startsWith("Tidak FEFO")).length,
  };
}

/**
 * What a line's pallet still holds after its own pick: the Sisa a new Bin To
 * Bin starts with. A posted line's pick has already left the stock.
 */
export function leftoverAfter(l: SheetLine, stock: SheetStock[]): number {
  const s = l.sources[0];
  const have = stock.filter((r) => r.bin === up(s.bin) && r.sku === l.sku && r.batch === s.batch.trim() && day(r.expiry) === day(s.expiry))
    .reduce((n, r) => n + r.qty, 0);
  return Math.max(l.posted || !l.pick ? have : have - (Number(s.qty) || 0), 0);
}
