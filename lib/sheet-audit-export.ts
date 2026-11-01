import { mergeDos } from "@/lib/audit-do";
import { PICK_ERROR_LABEL, type PickError, type MoveState } from "@/lib/pick-audit";

/**
 * A picking audit as spreadsheet rows, from the WMS file (0029-0032) or from
 * the system's pick tasks (0024-0032): one row per bin + SKU (what the rack
 * walk checks), one per pick line, and every attempt as history (corrections
 * included). `sisaLabel` names what the rack count was compared with.
 */
export type ExportLine = {
  id: string; shipment_number: string; wave_no: string | null; picklist: string | null; seq: number;
  bin_code: string; sku: string; description: string; uom: string | null; batch: string; expiry: string | null;
  qty: number; bin_remaining: number | null; line_state: "TODO" | "OK" | "MISMATCH" | "RESOLVED" | "AUTO_PASS";
  volume_l: number | null; // litres per carton/article for this SKU
  /** the DO (delivery order) numbers of this item (0121); absent when the source has none */
  do_nos?: string[];
  /** the ship-to company and its city (0123); absent when the source has none */
  destination?: string | null; ship_to_location?: string | null;
};
export type ExportAttempt = {
  line_id: string; attempt_no: number; checker_name: string; method: "STAGING" | "RACK" | "MOVE" | null; result: "OK" | "MISMATCH";
  errors: PickError[]; counted_qty: number; found_sku: string; found_batch: string; rack_system: number | null;
  rack_counted: number | null; note: string | null; correction: boolean; created_at: string;
};
type Row = Record<string, string | number | null>;

const STATE: Record<ExportLine["line_state"], string> = {
  TODO: "Belum diaudit", OK: "OK", MISMATCH: "Selisih", RESOLVED: "Diterima supervisor", AUTO_PASS: "Tidak dipick (0)",
};

const MOVE_STATE_LABEL: Record<MoveState, string> = {
  TODO: "Belum diaudit", OK: "OK", MISMATCH: "Selisih", RESOLVED: "Diterima supervisor", AUTO_PASS: "Tidak dipindah (0)",
};

/** 'YYYY-MM-DD HH:mm' in Jakarta time. */
export function jakartaTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 16);
}
const errorText = (errors: PickError[]) => errors.map((e) => PICK_ERROR_LABEL[e] ?? e).join(", ");
const zoneOf = (bin: string) => (/^[A-Z]{2}\d{2}[A-Z]\d{2}$/.test(bin) ? bin.slice(0, 2) : bin);
/** The distinct non-empty values of a shipment-level field, as one cell (0123). */
const uniqText = (vals: (string | null | undefined)[]) => [...new Set(vals.map((v) => v ?? "").filter((v) => v !== ""))].join(", ");

/** One posted Bin To Bin line for the Per bin sheet: a row for its source bin and one for its destination. */
export type ExportMove = {
  task_id: string; wave_no: string; seq: number;
  from_bin: string; from_zone: string | null; to_bin: string; to_zone: string | null;
  sku: string; description: string; uom: string | null;
  moved_qty: number; line_state: MoveState;
  /** 0114: the count left in the source bin; absent before 0114 is on the database */
  from_state?: "TODO" | "OK" | "MISMATCH" | "AUTO_PASS"; from_system?: number | null; from_counted?: number | null;
  from_checker?: string | null; from_found_sku?: string | null; from_note?: string | null;
  from_correction?: boolean | null; from_audited_at?: string | null;
  /** 0122: the shipments the move serves (derived from the wave, not stored on the task) */
  shipment_numbers?: string[] | null;
  /** the DOs of the pick this move is the pallet rest of (task_do_nos, 0124) */
  do_nos?: string[] | null;
  /** 0123: the ship-to companies and cities of those shipments; absent before 0123 is on the database */
  destinations?: string[] | null; ship_to_locations?: string[] | null;
};

/**
 * `moves` (system audit only): Bin To Bin lines go into Per bin next to the picked bins, one row per
 * bin they touch; `zone` keeps only the rows of that rack (a rack's own download).
 */
export function auditWorkbookRows(lines: ExportLine[], attempts: ExportAttempt[], sisaLabel = "Sisa di file", remain?: Map<string, number>,
  moves?: { rows: ExportMove[]; zone?: string }): { bins: Row[]; lines: Row[]; history: Row[] } {
  const byLine = new Map<string, ExportAttempt[]>();
  for (const a of [...attempts].sort((x, y) => x.attempt_no - y.attempt_no)) byLine.set(a.line_id, [...(byLine.get(a.line_id) ?? []), a]);
  const lastOf = (id: string) => byLine.get(id)?.at(-1);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  // "Remain Qty": the bin's stock of the SKU at day end (wms_day_report); only when the caller passes the map.
  const remainCol = (bin: string, sku: string): Row => (remain ? { "Remain Qty": remain.get(`${bin}|${sku}`) ?? 0 } : {});

  // Per bin + SKU: the latest count of any of its lines.
  const groups = new Map<string, ExportLine[]>();
  for (const l of lines) groups.set(`${l.bin_code}|${l.sku}`, [...(groups.get(`${l.bin_code}|${l.sku}`) ?? []), l]);
  const bins: Row[] = [...groups.values()].map((ls) => {
    const l = ls[0];
    const last = ls.map((x) => lastOf(x.id)).filter((a): a is ExportAttempt => !!a).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
    const remaining = ls.map((x) => x.bin_remaining).filter((n): n is number => n !== null);
    // The system count compares with the bin's stock at count time, kept on the attempt.
    const sisa = remaining.length ? Math.min(...remaining) : last?.method === "RACK" ? last.rack_system : null;
    const state = ls.some((x) => x.line_state === "MISMATCH") ? "MISMATCH" : ls.some((x) => x.line_state === "TODO") ? "TODO" : "OK";
    const counted = last?.method === "RACK" ? last.rack_counted : null;
    return {
      Rak: zoneOf(l.bin_code), Bin: l.bin_code, ...(moves ? { Jenis: "Pick" } : {}), SKU: l.sku, Deskripsi: l.description, UOM: l.uom,
      Shipment: [...new Set(ls.map((x) => x.shipment_number))].join(", "),
      // One bin + SKU can serve several DOs (one line each): the union, first-seen order.
      DO: mergeDos(...ls.map((x) => x.do_nos)).join(", "),
      // 0123: shipment-level ship-to party and city; one bin + SKU can serve several, so the distinct values.
      Destination: uniqText(ls.map((x) => x.destination)), "Location of the ship-to party": uniqText(ls.map((x) => x.ship_to_location)),
      ...(moves ? { "Bin To Bin": null } : {}), Baris: ls.length,
      "Qty pick": ls.reduce((s, x) => s + Number(x.qty), 0), ...(moves ? { "Qty Bin To Bin": null } : {}),
      ...remainCol(l.bin_code, l.sku), [sisaLabel]: sisa, "Sisa dihitung": counted, ...(moves ? { "Tiba dihitung": null } : {}),
      Selisih: counted !== null && sisa !== null ? Number(counted) - sisa : null,
      "Barang ditemukan": last && last.found_sku !== l.sku ? last.found_sku : null,
      Status: STATE[state as ExportLine["line_state"]], Checker: last?.checker_name ?? null, Waktu: jakartaTime(last?.created_at ?? null),
      Catatan: last?.note ?? null, Diubah: ls.some((x) => byLine.get(x.id)?.some((a) => a.correction)) ? "Ya" : null,
    };
  });
  if (moves) bins.push(...moveBinRows(moves.rows, attempts, sisaLabel, remainCol, moves.zone));
  bins.sort((a, b) => String(a.Rak).localeCompare(String(b.Rak)) || String(a.Bin).localeCompare(String(b.Bin))
    || String(a.Jenis ?? "").localeCompare(String(b.Jenis ?? "")));

  const lineRows: Row[] = [...lines].sort((a, b) => a.shipment_number.localeCompare(b.shipment_number) || a.seq - b.seq).map((l) => {
    const last = lastOf(l.id);
    const vol = l.volume_l != null ? Number((l.qty * l.volume_l).toFixed(1)) : null;
    return {
      Shipment: l.shipment_number, DO: mergeDos(l.do_nos).join(", "),
      // 0123: the shipment's ship-to party and city, right after its DO.
      Destination: l.destination ?? "", "Location of the ship-to party": l.ship_to_location ?? "",
      NO: l.wave_no, Picklist: l.picklist, Seq: l.seq, Bin: l.bin_code, SKU: l.sku, Deskripsi: l.description,
      Batch: l.batch, Expired: l.expiry, "Qty pick": Number(l.qty), ...remainCol(l.bin_code, l.sku), "Volume (L)": vol, Status: STATE[l.line_state], Error: last ? errorText(last.errors) : null,
      "Dihitung (baris)": last ? Number(last.counted_qty) : null, Checker: last?.checker_name ?? null, Waktu: jakartaTime(last?.created_at ?? null),
      Catatan: last?.note ?? null, Audit: byLine.get(l.id)?.length ?? 0,
    };
  });

  // Totals row for the day
  const totalBoxes = lineRows.reduce((s, r) => s + (Number(r["Qty pick"]) || 0), 0);
  const totalLitres = lineRows.reduce((s, r) => s + (Number(r["Volume (L)"]) || 0), 0);
  const totalsRow: Row = {
    Shipment: "TOTAL", DO: null, Destination: null, "Location of the ship-to party": null, NO: null, Picklist: null, Seq: null, Bin: null, SKU: null, Deskripsi: null,
    Batch: null, Expired: null, "Qty pick": totalBoxes, ...(remain ? { "Remain Qty": null } : {}), "Volume (L)": Number(totalLitres.toFixed(1)), Status: null, Error: null,
    "Dihitung (baris)": null, Checker: null, Waktu: null, Catatan: null, Audit: null,
  };
  const linesWithTotals = [...lineRows, totalsRow];

  // Only this sheet's lines: Bin To Bin attempts (same list in the system audit) have their own history rows.
  const history: Row[] = [...attempts].filter((a) => lineById.has(a.line_id)).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((a) => {
    const l = lineById.get(a.line_id);
    return {
      Waktu: jakartaTime(a.created_at), Bin: l?.bin_code ?? null, SKU: l?.sku ?? null, Shipment: l?.shipment_number ?? null,
      "Audit ke": a.attempt_no, Checker: a.checker_name, Cara: a.method === "RACK" ? "Per rak" : a.method === "MOVE" ? "Pindahan bin" : "Per shipment",
      Hasil: a.result === "OK" ? "OK" : "Selisih", Error: errorText(a.errors), [sisaLabel]: a.rack_system, "Sisa dihitung": a.rack_counted,
      "Dihitung (baris)": Number(a.counted_qty), Ditemukan: a.found_sku, Catatan: a.note, Ubah: a.correction ? "Ya" : null,
    };
  });
  return { bins, lines: linesWithTotals, history };
}

const FROM_STATE_TEXT = { TODO: "Belum dihitung", OK: "OK", MISMATCH: "Selisih", AUTO_PASS: "Tidak dipindah (0)" } as const;

/**
 * Per bin rows of the Bin To Bin lines, in the same columns as the picked bins: the source bin (what
 * is left after the move, counted like a rack count, 0114) and the destination bin (what arrived, 0088).
 */
function moveBinRows(moves: ExportMove[], attempts: ExportAttempt[], sisaLabel: string,
  remainCol: (bin: string, sku: string) => Row, zone?: string): Row[] {
  const byTask = new Map<string, ExportAttempt[]>();
  for (const a of [...attempts].sort((x, y) => x.attempt_no - y.attempt_no)) byTask.set(a.line_id, [...(byTask.get(a.line_id) ?? []), a]);
  const rows: Row[] = [];
  for (const m of moves) {
    if (m.line_state === "AUTO_PASS") continue;
    const route = `NO ${m.wave_no} #${m.seq}: ${m.from_bin} → ${m.to_bin}`;
    const fromZone = m.from_zone ?? zoneOf(m.from_bin), toZone = m.to_zone ?? zoneOf(m.to_bin);
    // 0122: a move belongs to the shipments the wave picks for its SKU, so its DO is not lost on a move.
    const shipments = (m.shipment_numbers ?? []).join(", ");
    const dos = mergeDos(m.do_nos).join(", ");
    // 0123: the ship-to parties and cities of those shipments, as the view derives them.
    const destinations = (m.destinations ?? []).join(", "), locations = (m.ship_to_locations ?? []).join(", ");
    if (m.from_state && (!zone || fromZone === zone)) {
      const counted = m.from_counted ?? null, sys = m.from_system ?? null;
      rows.push({
        Rak: fromZone, Bin: m.from_bin, Jenis: "Bin To Bin (asal)", SKU: m.sku, Deskripsi: m.description, UOM: m.uom,
        Shipment: shipments, DO: dos, Destination: destinations, "Location of the ship-to party": locations,
        "Bin To Bin": route, Baris: 1, "Qty pick": null, "Qty Bin To Bin": -Number(m.moved_qty),
        ...remainCol(m.from_bin, m.sku), [sisaLabel]: sys, "Sisa dihitung": counted, "Tiba dihitung": null,
        Selisih: counted !== null && sys !== null ? Number(counted) - Number(sys) : null,
        "Barang ditemukan": m.from_found_sku ?? null, Status: FROM_STATE_TEXT[m.from_state],
        Checker: m.from_checker ?? null, Waktu: jakartaTime(m.from_audited_at ?? null), Catatan: m.from_note ?? null,
        Diubah: m.from_correction ? "Ya" : null,
      });
    }
    if (!zone || toZone === zone) {
      const hist = byTask.get(m.task_id) ?? [];
      const last = hist.at(-1);
      rows.push({
        Rak: toZone, Bin: m.to_bin, Jenis: "Bin To Bin (tujuan)", SKU: m.sku, Deskripsi: m.description, UOM: m.uom,
        Shipment: shipments, DO: dos, Destination: destinations, "Location of the ship-to party": locations,
        "Bin To Bin": route, Baris: 1, "Qty pick": null, "Qty Bin To Bin": Number(m.moved_qty),
        // A rack count (0115) compares the whole bin with the system, like a picked bin; a blind audit (0088)
        // counted what arrived against the moved quantity.
        ...remainCol(m.to_bin, m.sku),
        [sisaLabel]: last?.method === "RACK" ? last.rack_system : null,
        "Sisa dihitung": last?.method === "RACK" ? last.rack_counted : null,
        "Tiba dihitung": last ? Number(last.counted_qty) : null,
        Selisih: !last ? null : last.method === "RACK" ? Number(last.rack_counted) - Number(last.rack_system)
          : Number(last.counted_qty) - Number(m.moved_qty),
        "Barang ditemukan": last && last.found_sku !== m.sku ? last.found_sku : null, Status: MOVE_STATE_LABEL[m.line_state],
        Checker: last?.checker_name ?? null, Waktu: jakartaTime(last?.created_at ?? null), Catatan: last?.note ?? null,
        Diubah: hist.some((a) => a.correction) ? "Ya" : null,
      });
    }
  }
  return rows;
}

/**
 * Build move-audit export rows: one row per move line.
 * Mirrors auditWorkbookRows style but for REPLENISH (no shipment of its own, has to_bin).
 */
export function moveRows(
  lines: Array<{
    task_id: string; wave_no: string; seq: number;
    from_bin: string; from_zone: string | null; to_bin: string; to_zone: string | null;
    sku: string; description: string; uom: string | null;
    batch: string; expiry: string | null;
    planned_qty: number; moved_qty: number;
    line_state: MoveState;
    /** 0122: the shipments the move serves and their DOs (absent before 0122 is on the database) */
    shipment_numbers?: string[] | null; do_nos?: string[] | null;
    /** 0123: the ship-to companies and cities of those shipments (absent before 0123 is on the database) */
    destinations?: string[] | null; ship_to_locations?: string[] | null;
  }>,
  attempts: ExportAttempt[]
): { lines: Row[]; history: Row[] } {
  const byLine = new Map<string, ExportAttempt[]>();
  for (const a of [...attempts].sort((x, y) => x.attempt_no - y.attempt_no)) byLine.set(a.line_id, [...(byLine.get(a.line_id) ?? []), a]);
  const lastOf = (id: string) => byLine.get(id)?.at(-1);
  const lineById = new Map(lines.map((l) => [l.task_id, l]));

  const lineRows: Row[] = [...lines].sort((a, b) => a.seq - b.seq).map((l) => {
    const last = lastOf(l.task_id);
    return {
      NO: l.wave_no, Seq: l.seq,
      "Dari bin": l.from_bin, "Zona asal": l.from_zone,
      "Ke bin": l.to_bin, "Zona tujuan": l.to_zone,
      // 0122: the wave's shipments and DOs, so a move shows them like a pick does.
      Shipment: (l.shipment_numbers ?? []).join(", "), DO: mergeDos(l.do_nos).join(", "),
      // 0123: the ship-to parties and cities of those shipments, right after the DO.
      Destination: (l.destinations ?? []).join(", "), "Location of the ship-to party": (l.ship_to_locations ?? []).join(", "),
      SKU: l.sku, Deskripsi: l.description, UOM: l.uom,
      Batch: l.batch, Expired: l.expiry,
      Rencana: Number(l.planned_qty), Dipindah: Number(l.moved_qty),
      Status: MOVE_STATE_LABEL[l.line_state],
      Error: last ? errorText(last.errors) : null,
      "Dihitung (baris)": last ? Number(last.counted_qty) : null,
      Selisih: last ? Number(last.counted_qty) - Number(l.moved_qty) : null,
      "Barang ditemukan": last && last.found_sku !== l.sku ? last.found_sku : null,
      Checker: last?.checker_name ?? null, Waktu: jakartaTime(last?.created_at ?? null),
      Catatan: last?.note ?? null,
      Diubah: byLine.get(l.task_id)?.some((a) => a.correction) ? "Ya" : null,
    };
  });

  const history: Row[] = [...attempts].filter((a) => lineById.has(a.line_id)).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((a) => {
    const l = lineById.get(a.line_id);
    return {
      Waktu: jakartaTime(a.created_at),
      "Dari bin": l?.from_bin ?? null, "Zona asal": l?.from_zone ?? null,
      "Ke bin": l?.to_bin ?? null, "Zona tujuan": l?.to_zone ?? null,
      // 0122: same keys as a pick attempt's history row, so one Riwayat sheet reads the same for both.
      Shipment: l?.shipment_numbers?.join(", ") ?? null, DO: l ? mergeDos(l.do_nos).join(", ") : null,
      SKU: l?.sku ?? null,
      "Audit ke": a.attempt_no, Checker: a.checker_name, Cara: "Pindahan bin",
      Hasil: a.result === "OK" ? "OK" : "Selisih", Error: errorText(a.errors),
      "Sisa sistem (dipindah)": a.rack_system, "Sisa dihitung": a.rack_counted,
      "Dihitung (baris)": Number(a.counted_qty), Ditemukan: a.found_sku, Catatan: a.note, Ubah: a.correction ? "Ya" : null,
    };
  });
  return { lines: lineRows, history };
}