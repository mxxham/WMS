import type { PlanTask } from "./allocator/plan";

/**
 * Tambah item edits: the supervisor makes the new rows match the printed
 * picklist — any source bin, any Bin To Bin destination and sisa quantity,
 * also a Bin To Bin on a line the engine gave none. Pure: plan tasks and
 * edits in, the tasks to save plus per-line warnings and errors out. A
 * later expiry than the plan is a warning, never a block (the paper is
 * not always FEFO); add_wave_items (0051) logs every change with a reason.
 */

/** One planning-stock row of a SKU (bin + batch + expiry), offered as a source. */
export type BinOption = { key: string; location: string; batch: string; expiryDate: string; qtyCartons: number };
/** The Sumber value that means "a bin typed by hand". */
export const OTHER_BIN = "__other";
export type LineEdit = { sourceKey?: string; typedBin?: string; moveTo?: string; moveQty?: string };
/** The engine's values for a changed row, sent so the database can log what changed. Null fields: the row is new. */
export type Planned = { from_bin: string | null; to_bin: string | null; batch_lot: string | null; expiry_date: string | null; quantity: number | null };
export type EditedTask = PlanTask & { planned?: Planned };
export type LineResult = {
  pick: EditedTask; move: EditedTask | null;
  /** The engine's own move for this pick, before edits. */
  plannedMove: PlanTask | null;
  /** Free stock left in the chosen source after every pick of this plan on it; null when unknown. */
  leftover: number | null;
  changed: boolean; warnings: string[]; error: string | null;
};
export type EditResult = { tasks: EditedTask[]; lines: Map<number, LineResult>; changed: boolean; error: string | null };

const BIN_FORMAT = /^[A-Z0-9_]{3,20}$/;
export const optionKey = (bin: string, batch: string, expiry: string) => `${bin}|${batch}|${expiry}`;

/** The REPLENISH buildPlan pushed right after this pick (same SKU, same source). */
export function pairedMoveAt(tasks: PlanTask[], pickIndex: number): PlanTask | null {
  const pick = tasks[pickIndex];
  for (let j = pickIndex + 1; j < tasks.length; j++) {
    const next = tasks[j];
    if (next.task_type === "PICK") break;
    if (next.task_type === "REPLENISH" && next.sku === pick.sku && next.from_bin === pick.from_bin) return next;
  }
  return null;
}

/** The pick's source after its Sumber edit; a typed bin holding one row of the SKU takes that row's batch/expiry. */
export function resolveSource(pick: PlanTask, edit: LineEdit | undefined, options: BinOption[]):
  { from_bin: string; batch_lot: string; expiry_date: string; option: BinOption | null } {
  const plannedKey = optionKey(pick.from_bin, pick.batch_lot, pick.expiry_date);
  const own = options.find((o) => o.key === plannedKey) ?? null;
  const keep = { from_bin: pick.from_bin, batch_lot: pick.batch_lot, expiry_date: pick.expiry_date, option: own };
  if (!edit?.sourceKey) return keep;
  if (edit.sourceKey === OTHER_BIN) {
    const bin = (edit.typedBin ?? "").trim().toUpperCase();
    if (!bin) return keep;
    const atBin = options.filter((o) => o.location === bin);
    const same = atBin.find((o) => o.batch === pick.batch_lot && o.expiryDate === pick.expiry_date);
    const o = same ?? (atBin.length === 1 ? atBin[0] : null);
    return o ? { from_bin: o.location, batch_lot: o.batch, expiry_date: o.expiryDate, option: o }
      : { from_bin: bin, batch_lot: pick.batch_lot, expiry_date: pick.expiry_date, option: null };
  }
  const o = options.find((x) => x.key === edit.sourceKey);
  return o ? { from_bin: o.location, batch_lot: o.batch, expiry_date: o.expiryDate, option: o } : keep;
}

/**
 * Applies every line's edits to a copy of the plan. A changed source
 * defaults its sisa to what that bin really keeps (free stock minus every
 * pick of this plan on it), never the engine's number for the old bin; a
 * typed sisa wins. A move with no destination or sisa 0 is dropped. Rows
 * are renumbered 1..n so a pick and its move stay side by side.
 */
export function applyLineEdits(tasks: PlanTask[], edits: Record<number, LineEdit>,
  optionsBySku: Map<string, BinOption[]>, pickfaces: Set<string>): EditResult {
  const sources = new Map<number, ReturnType<typeof resolveSource>>();
  const usedByKey = new Map<string, number>();
  tasks.forEach((t, i) => {
    if (t.task_type !== "PICK") return;
    const s = resolveSource(t, edits[i], optionsBySku.get(t.sku) ?? []);
    sources.set(i, s);
    const k = optionKey(s.from_bin, s.batch_lot, s.expiry_date);
    usedByKey.set(k, (usedByKey.get(k) ?? 0) + Number(t.quantity));
  });

  const out: EditedTask[] = [];
  const lines = new Map<number, LineResult>();
  let anyChange = false, firstError: string | null = null;
  tasks.forEach((t, i) => {
    if (t.task_type !== "PICK") return;
    const edit = edits[i] ?? {};
    const s = sources.get(i)!;
    const plannedMove = pairedMoveAt(tasks, i);
    const warnings: string[] = [];
    let error: string | null = null;
    const sourceChanged = s.from_bin !== t.from_bin || s.batch_lot !== t.batch_lot || s.expiry_date !== t.expiry_date;
    const used = usedByKey.get(optionKey(s.from_bin, s.batch_lot, s.expiry_date)) ?? 0;
    const leftover = s.option ? s.option.qtyCartons - used : null;

    if (edit.sourceKey === OTHER_BIN && !BIN_FORMAT.test(s.from_bin)) error = `bin sumber "${s.from_bin}" bukan format bin yang valid`;
    if (sourceChanged && s.expiry_date > t.expiry_date) {
      warnings.push(`FEFO dilewati: exp ${s.expiry_date} lebih lama dari rencana ${t.expiry_date}.`);
    }
    if (sourceChanged && !s.option) {
      warnings.push(`${s.from_bin} tidak ada di stok yang bisa dipick untuk SKU ini. Disimpan hanya bila database mencatat batch ${s.batch_lot || "–"} exp ${s.expiry_date} di bin itu.`);
    } else if (sourceChanged && leftover !== null && leftover < 0) {
      warnings.push(`Stok bebas di ${s.from_bin} kurang ${-leftover} untuk pick di rencana ini: tugas tampil stok kurang sampai stok dikoreksi.`);
    }

    const to = (edit.moveTo ?? plannedMove?.to_bin ?? "").trim().toUpperCase();
    const defaultQty = !plannedMove ? (leftover !== null && leftover > 0 ? leftover : 0)
      : !sourceChanged ? Number(plannedMove.quantity)
      : leftover !== null ? Math.max(leftover, 0) : Number(plannedMove.quantity);
    const qtyRaw = edit.moveQty?.trim();
    const qty = qtyRaw === undefined || qtyRaw === "" ? (edit.moveTo !== undefined || plannedMove ? defaultQty : 0) : Number(qtyRaw);
    let move: EditedTask | null = null;
    if (to) {
      if (!BIN_FORMAT.test(to)) error ??= `tujuan Bin To Bin "${to}" bukan format bin yang valid`;
      else if (to === s.from_bin) error ??= `bin asal (${s.from_bin}) dan tujuan Bin To Bin tidak boleh sama`;
      else if (!Number.isInteger(qty) || qty < 0) error ??= "jumlah sisa harus bilangan bulat";
      else if (qty === 0 && !qtyRaw && !plannedMove) error ??= "isi jumlah sisa untuk Bin To Bin";
      else if (qty === 0 && !qtyRaw) warnings.push(`Tidak ada sisa bebas di ${s.from_bin}: Bin To Bin tidak disimpan. Isi jumlah sisa bila picklist cetak tetap memindahkannya.`);
      else if (qty > 0) {
        move = {
          ...t, shipment_number: null, task_type: "REPLENISH", from_bin: s.from_bin, to_bin: to,
          batch_lot: s.batch_lot, expiry_date: s.expiry_date, quantity: qty, pick_type: "CASE", breaks_pallet: true,
        };
        if (leftover !== null && qty > Math.max(leftover, 0)) warnings.push(`Sisa ${qty} lebih dari stok bebas yang tersisa di ${s.from_bin} (${Math.max(leftover, 0)}).`);
        if (pickfaces.has(`${t.sku}|${s.from_bin}`)) warnings.push(`${s.from_bin} adalah pickface SKU ini: biasanya pickface diisi, bukan dikosongkan.`);
      }
    }
    const moveChanged = plannedMove
      ? !move || move.from_bin !== plannedMove.from_bin || move.to_bin !== plannedMove.to_bin || move.quantity !== Number(plannedMove.quantity)
        || move.batch_lot !== plannedMove.batch_lot
      : move !== null;
    const changed = sourceChanged || moveChanged;

    const pick: EditedTask = { ...t, from_bin: s.from_bin, batch_lot: s.batch_lot, expiry_date: s.expiry_date };
    if (sourceChanged) pick.planned = { from_bin: t.from_bin, to_bin: null, batch_lot: t.batch_lot, expiry_date: t.expiry_date, quantity: Number(t.quantity) };
    if (move && moveChanged) {
      move.planned = plannedMove
        ? { from_bin: plannedMove.from_bin, to_bin: plannedMove.to_bin, batch_lot: plannedMove.batch_lot, expiry_date: plannedMove.expiry_date, quantity: Number(plannedMove.quantity) }
        : { from_bin: null, to_bin: null, batch_lot: null, expiry_date: null, quantity: null };
    }
    // A planned move dropped by the edit leaves no row; the pick carries the note so the log says so.
    if (plannedMove && !move) {
      pick.planned ??= { from_bin: t.from_bin, to_bin: null, batch_lot: t.batch_lot, expiry_date: t.expiry_date, quantity: Number(t.quantity) };
      pick.planned.to_bin = plannedMove.to_bin;
    }
    out.push(pick);
    if (move) out.push(move);
    if (changed) anyChange = true;
    if (error && !firstError) firstError = `Baris #${t.seq}: ${error}.`;
    lines.set(i, { pick, move, plannedMove, leftover, changed, warnings, error });
  });
  out.forEach((t, n) => { t.seq = n + 1; });
  return { tasks: out, lines, changed: anyChange, error: firstError };
}
