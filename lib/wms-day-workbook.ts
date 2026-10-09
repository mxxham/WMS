import ExcelJS from "exceljs";

/** One row of wms_day_report (0055). */
export type WmsDayRow = {
  bin_code: string; sku: string; description: string | null; uom: string | null; upp: number | null; batch_lot: string;
  expiry_date: string | null; received_date: string | null;
  on_hand: number; pick: number; b_out: number; b_in: number; putaway: number; adjust: number; remain: number;
};

const FONT = { name: "Calibri", size: 11 };
const NUM = '#,##0;[Red]-#,##0;"–"'; // zero as a dash: the numbers that matter stand out
const DATE = "dd/mm/yyyy";
const TITLE_ROWS = 3; // title, summary, column groups; the table header is row 4
const ZEROED = "Nol oleh impor/adjust";

/**
 * Every colour is set on the cells themselves. Excel table styles are not
 * drawn by LibreOffice/WPS (5 Oct: the header came out white on white), so the
 * table only supplies the filter buttons and the Total row.
 */
const C = {
  navy: "FF1F3864", blue: "FF2F5597", grey: "FF7F7F7F", green: "FF548235", gold: "FFBF8F00",
  band: "FFF3F6FA", line: "FFD9D9D9", total: "FFDDE4EE",
  remain: "FFE2EFDA", sapInput: "FFFFF2CC", ok: "FFE2EFDA", warn: "FFFFF2CC", muted: "FFEDEDED",
};
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin = { style: "thin" as const, color: { argb: C.line } };
const GRID: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };

/** "YYYY-MM-DD" as a real Excel date (UTC midnight, so no timezone shift). */
function asDate(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}

/** What a row is, for filtering: stock left, emptied by today's work, or zeroed by the import/an adjustment. */
export function rowStatus(r: WmsDayRow): string {
  const remain = Number(r.remain), onHand = Number(r.on_hand);
  if (remain > 0) return "Ada stok";
  if (onHand === 0 && Number(r.pick) === 0 && Number(r.b_out) === 0) return ZEROED;
  return "Habis hari ini";
}

const STATUS_FILL: Record<string, string> = { "Ada stok": C.ok, "Habis hari ini": C.warn, [ZEROED]: C.muted };

type Col = {
  name: string; width: number; fmt?: string; sum?: boolean; key?: boolean;
  head?: string; // header colour, by column group
  shade?: string; // body fill that marks the column to read
  align?: "left" | "center" | "right";
};
type Group = { label: string; from: number; to: number; color: string };

function title(ws: ExcelJS.Worksheet, text: string, sub: string, width: number) {
  ws.mergeCells(1, 1, 1, width);
  ws.getCell(1, 1).value = text;
  ws.getCell(1, 1).font = { ...FONT, size: 16, bold: true, color: { argb: C.navy } };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, width);
  ws.getCell(2, 1).value = sub;
  ws.getCell(2, 1).font = { ...FONT, size: 10, color: { argb: "FF404040" } };
  ws.getRow(2).height = 18;
}

/** Row 3: a coloured label over each column group ("Hari ini", "Info"…). */
function groups(ws: ExcelJS.Worksheet, gs: Group[]) {
  for (const g of gs) {
    if (g.to > g.from) ws.mergeCells(TITLE_ROWS, g.from, TITLE_ROWS, g.to);
    const cell = ws.getCell(TITLE_ROWS, g.from);
    cell.value = g.label;
    cell.font = { ...FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(g.color);
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  ws.getRow(TITLE_ROWS).height = 18;
}

/**
 * An Excel table (filter buttons, a Total row that follows the filter) under
 * the title, with header, banding, borders and number formats drawn per cell.
 */
function table(ws: ExcelJS.Worksheet, name: string, cols: Col[], data: ExcelJS.CellValue[][], rowFill?: (i: number) => string | undefined) {
  const top = TITLE_ROWS + 1;
  const rows = data.length > 0 ? data : [cols.map(() => null)]; // an Excel table needs at least one row
  ws.addTable({
    name, ref: `A${top}`, headerRow: true, totalsRow: true,
    style: { theme: "TableStyleLight1", showRowStripes: false },
    columns: cols.map((c, i) => ({
      name: c.name, filterButton: true,
      ...(c.sum ? { totalsRowFunction: "sum" as const } : i === 0 ? { totalsRowLabel: "Total" } : {}),
    })),
    rows,
  });
  const last = top + rows.length + 1; // header + rows + total

  ws.getRow(top).height = 34;
  cols.forEach((c, i) => {
    const col = i + 1;
    ws.getColumn(col).width = c.width;
    const h = ws.getCell(top, col);
    h.font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = fill(c.head ?? C.navy);
    h.alignment = { horizontal: c.fmt === NUM ? "center" : "left", vertical: "middle", wrapText: true };
    h.border = GRID;

    for (let r = top + 1; r < last; r++) {
      const cell = ws.getCell(r, col);
      const band = rowFill?.(r - top - 1) ?? ((r - top) % 2 === 0 ? C.band : undefined);
      cell.font = { ...FONT, bold: !!c.key };
      cell.border = GRID;
      if (c.fmt) cell.numFmt = c.fmt;
      if (c.align) cell.alignment = { horizontal: c.align };
      const f = c.shade ?? band;
      if (f) cell.fill = fill(f);
    }

    const t = ws.getCell(last, col);
    t.font = { ...FONT, bold: true };
    t.fill = fill(C.total);
    t.border = { top: { style: "double", color: { argb: C.navy } }, bottom: { style: "thin", color: { argb: C.navy } } };
    if (c.fmt) t.numFmt = c.fmt;
  });
  ws.getRow(last).height = 20;

  ws.views = [{ state: "frozen", xSplit: 1, ySplit: top, activeCell: `A${top + 1}`, showGridLines: false }];
  ws.pageSetup = {
    orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${top}:${top}`,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  ws.headerFooter = { oddFooter: "&L&8&A&R&8Halaman &P dari &N" };
}

const fmtN = (v: number) => v.toLocaleString("id-ID");

/** The per-bin sheet: WMS (rows with stock or movement today) and Nol impor (rows only the import/an adjustment zeroed). */
function binSheet(wb: ExcelJS.Workbook, sheet: string, tableName: string, tab: string, heading: string, sub: string, rows: WmsDayRow[]) {
  const ws = wb.addWorksheet(sheet, { properties: { tabColor: { argb: tab } } });
  const cols: Col[] = [
    { name: "Lokasi", width: 10, key: true }, { name: "Item", width: 11 }, { name: "Description", width: 36 }, { name: "UOM", width: 6, align: "center" },
    { name: "Batch", width: 11 }, { name: "GR date", width: 11, fmt: DATE, align: "center" }, { name: "Expired Date", width: 11, fmt: DATE, align: "center" },
    { name: "UPP", width: 6, fmt: NUM },
    { name: "Qty (on hand)", width: 9, fmt: NUM, sum: true, key: true },
    { name: "PICK", width: 8, fmt: NUM, sum: true, head: C.blue }, { name: "b out", width: 8, fmt: NUM, sum: true, head: C.blue },
    { name: "b in", width: 8, fmt: NUM, sum: true, head: C.blue },
    { name: "putaway", width: 9, fmt: NUM, sum: true, head: C.grey }, { name: "Adjust", width: 9, fmt: NUM, sum: true, head: C.grey },
    { name: "Remain Qty", width: 10, fmt: NUM, sum: true, key: true, head: C.green, shade: C.remain },
    { name: "Status", width: 20, align: "center" },
  ];
  title(ws, heading, sub, cols.length);
  groups(ws, [
    { label: "Stok di bin", from: 1, to: 9, color: C.navy },
    { label: "Gerak hari ini", from: 10, to: 12, color: C.blue },
    { label: "Info · sudah di Qty", from: 13, to: 14, color: C.grey },
    { label: "Akhir", from: 15, to: 16, color: C.green },
  ]);
  const n = (v: number) => Number(v);
  table(ws, tableName, cols, rows.map((r) => [
    r.bin_code, r.sku, r.description ?? "", r.uom ?? "", r.batch_lot, asDate(r.received_date), asDate(r.expiry_date), r.upp == null ? null : n(r.upp),
    n(r.on_hand), n(r.pick), n(r.b_out), n(r.b_in), n(r.putaway), n(r.adjust), n(r.remain), rowStatus(r),
  ]));
  rows.forEach((r, i) => {
    const cell = ws.getCell(TITLE_ROWS + 2 + i, 16);
    cell.fill = fill(STATUS_FILL[rowStatus(r)] ?? C.muted);
  });
  return ws;
}

/**
 * "Laporan WMS harian" as a formatted workbook: sheet WMS per bin, sheet SAP
 * per SKU with a Stok SAP column to type into and its Selisih, sheet Nol impor
 * with the lines the morning import zeroed (noise for SAP), sheet Catatan.
 */
export function buildWmsDayWorkbook(rows: WmsDayRow[], date: string, generatedAt = new Date()): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CKB Warehouse WMS";
  wb.created = generatedAt;
  const made = generatedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
  const n = (v: number) => Number(v);

  const byBin = (a: WmsDayRow, b: WmsDayRow) => a.bin_code.localeCompare(b.bin_code) || a.sku.localeCompare(b.sku) || a.batch_lot.localeCompare(b.batch_lot);
  const live = rows.filter((r) => rowStatus(r) !== ZEROED).sort(byBin);
  const zeroed = rows.filter((r) => rowStatus(r) === ZEROED).sort(byBin);
  const sum = (k: keyof WmsDayRow) => live.reduce((s, r) => s + n(r[k] as number), 0);

  // ---- WMS: one row per bin + SKU + batch + expiry ---------------------------
  binSheet(wb, "WMS", "WMS", C.navy, `Laporan WMS harian · ${date}`,
    `Qty ${fmtN(sum("on_hand"))} · PICK ${fmtN(sum("pick"))} · b out ${fmtN(sum("b_out"))} · b in ${fmtN(sum("b_in"))} · Remain ${fmtN(sum("remain"))}` +
    `   |   ${fmtN(live.length)} baris` + (zeroed.length ? ` (${fmtN(zeroed.length)} baris nol impor di sheet Nol impor)` : "") +
    ` · dibuat ${made}`, live);

  // ---- SAP: one row per SKU, with room for the SAP figure ---------------------
  const sap = wb.addWorksheet("SAP", { properties: { tabColor: { argb: C.green } } });
  const bySku = new Map<string, { sku: string; description: string; uom: string; bins: number; on_hand: number; pick: number; b_out: number; b_in: number; remain: number }>();
  for (const r of live) {
    const e = bySku.get(r.sku) ?? { sku: r.sku, description: r.description ?? "", uom: r.uom ?? "", bins: 0, on_hand: 0, pick: 0, b_out: 0, b_in: 0, remain: 0 };
    e.bins += 1; e.on_hand += n(r.on_hand); e.pick += n(r.pick); e.b_out += n(r.b_out); e.b_in += n(r.b_in); e.remain += n(r.remain);
    bySku.set(r.sku, e);
  }
  const skus = [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  const sapCols: Col[] = [
    { name: "Item", width: 12, key: true }, { name: "Description", width: 40 }, { name: "UOM", width: 6, align: "center" },
    { name: "Baris", width: 7, fmt: NUM, sum: true },
    { name: "On hand", width: 10, fmt: NUM, sum: true, key: true },
    { name: "PICK", width: 9, fmt: NUM, sum: true, head: C.blue }, { name: "b out", width: 9, fmt: NUM, sum: true, head: C.blue },
    { name: "b in", width: 9, fmt: NUM, sum: true, head: C.blue },
    { name: "Remain WMS", width: 11, fmt: NUM, sum: true, key: true, head: C.green, shade: C.remain },
    { name: "Stok SAP (isi)", width: 12, fmt: NUM, sum: true, head: C.gold, shade: C.sapInput },
    { name: "Selisih (WMS − SAP)", width: 13, fmt: NUM, sum: true, key: true },
  ];
  title(sap, `Rekap per SKU untuk SAP · ${date}`,
    `${fmtN(skus.length)} SKU · Remain ${fmtN(sum("remain"))} · isi kolom kuning dari SAP; Selisih terisi otomatis (merah = WMS kurang, kuning = WMS lebih)`, sapCols.length);
  groups(sap, [
    { label: "SKU", from: 1, to: 5, color: C.navy },
    { label: "Gerak hari ini", from: 6, to: 8, color: C.blue },
    { label: "Bandingkan", from: 9, to: 11, color: C.green },
  ]);
  const first = TITLE_ROWS + 2;
  table(sap, "SAP", sapCols, skus.map((s, i) => {
    const r = first + i;
    return [s.sku, s.description, s.uom, s.bins, s.on_hand, s.pick, s.b_out, s.b_in, s.remain, null, { formula: `IF(J${r}="","",I${r}-J${r})`, result: "" }];
  }));
  if (skus.length > 0) {
    sap.addConditionalFormatting({
      ref: `K${first}:K${first + skus.length - 1}`,
      rules: [
        { type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } }, font: { color: { argb: "FF9C0006" }, bold: true } } },
        { type: "cellIs", operator: "greaterThan", formulae: ["0"], priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFEB9C" } }, font: { color: { argb: "FF9C5700" }, bold: true } } },
      ],
    });
  }

  // ---- Nol impor: lines only the import or an adjustment zeroed ---------------
  if (zeroed.length > 0) {
    binSheet(wb, "Nol impor", "NolImpor", C.grey, `Baris nol oleh impor/adjust · ${date}`,
      `${fmtN(zeroed.length)} baris: tidak ada di file WMS pagi ini (atau di-adjust ke 0), tanpa pick/pindah. Bukan stok; tidak ikut sheet WMS dan SAP.`, zeroed);
  }

  // ---- Catatan: what each column means ----------------------------------------
  const note = wb.addWorksheet("Catatan", { properties: { tabColor: { argb: C.grey } } });
  note.getColumn(1).width = 24;
  note.getColumn(2).width = 96;
  title(note, "Cara membaca laporan", `Laporan WMS harian ${date} · dari riwayat mutasi sistem (Asia/Jakarta)`, 2);
  const lines: [string, string, string?][] = [
    ["Qty (on hand)", "Stok setelah inbound/putaway selesai, sebelum picking hari itu.", C.navy],
    ["PICK", "Karton yang dipick hari itu dari bin ini (pick yang dibatalkan sudah dikurangkan).", C.blue],
    ["b out / b in", "Pindah keluar / masuk bin hari itu (Bin To Bin, Mutasi).", C.blue],
    ["putaway, Adjust", "Jumlah hari itu, hanya informasi: SUDAH termasuk di Qty, jangan dikurangkan lagi.", C.grey],
    ["Adjust minus", "Stok dikurangi oleh impor WMS pagi (file lebih sedikit dari sistem), hitung ulang, atau Adjust manual.", C.grey],
    ["Remain Qty", "Stok setelah picking = Qty − PICK − b out + b in. Ini on hand besok, dan angka yang dibandingkan dengan SAP.", C.green],
    ["Status", "Ada stok (hijau) · Habis hari ini (kuning): habis karena pick/pindah.", C.navy],
    ["Nol impor", "Baris yang hanya dinolkan oleh impor pagi (tidak ada di file WMS) atau Adjust, tanpa pick/pindah. Dipisah agar sheet WMS hanya berisi stok nyata.", C.grey],
    ["–", "Tanda strip berarti 0.", C.navy],
    ["Filter & Total", "Tombol filter di setiap judul kolom. Baris Total ikut filter: hanya menjumlah baris yang terlihat.", C.navy],
    ["SAP", "Total per SKU dari sheet WMS. Isi Stok SAP (kuning); Selisih merah = WMS kurang dari SAP, kuning = WMS lebih.", C.gold],
  ];
  lines.forEach(([k, v, color], i) => {
    const row = note.getRow(TITLE_ROWS + 1 + i);
    row.values = [k, v];
    row.height = 30;
    const a = row.getCell(1), b = row.getCell(2);
    a.font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } };
    a.fill = fill(color ?? C.navy);
    a.alignment = { vertical: "middle", indent: 1 };
    b.font = FONT;
    b.alignment = { wrapText: true, vertical: "middle", indent: 1 };
    a.border = b.border = GRID;
  });
  note.views = [{ showGridLines: false }];
  note.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return wb;
}
