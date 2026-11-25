/**
 * The housekeeping photo pack: one PDF for one rack and one week or month, one page per done day with the first
 * before photo and the last after photo. Built in the browser (a server response is limited to a few MB, a month of photos
 * is not); photos come through the gated route with ?raw=1 and are scaled down on a canvas before they go into the file.
 * No person's name is ever on a page.
 */
import { createClient } from "@/lib/supabase/client";
import { dateLabel, dayFull, fitBox, pickPackPhotos, type PackPhoto } from "@/lib/ckb/housekeeping";

const EDGE = 800;          // long edge of a photo in the file, px
const QUALITY = 0.72;

type Loaded = { data: string; w: number; h: number } | null;

async function loadPhoto(id: string, signal?: AbortSignal): Promise<Loaded> {
  const res = await fetch(`/api/ckb/housekeeping/photo/${id}?raw=1`, { signal });
  if (!res.ok) return null;
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { data: canvas.toDataURL("image/jpeg", QUALITY), w, h };
}

/** The photos of one day of one rack (name-free; works for a customer, a lead and a PIC). */
async function dayPhotos(area: string, day: string): Promise<PackPhoto[]> {
  const { data, error } = await createClient().rpc("ckb_hk_customer_day", { p_area: area, p_day: day });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { kind: PackPhoto["kind"]; photo_id: string; uploaded_at: string; late: boolean; on_behalf: boolean }[])
    .map((r) => ({ kind: r.kind, photo_id: r.photo_id, uploaded_at: r.uploaded_at, late: r.late, on_behalf: r.on_behalf }));
}

export type PackInput = {
  areaId: string; areaCode: string; areaName: string; customerName: string; from: string; to: string; days: string[];
  onProgress?: (done: number, total: number) => void; signal?: AbortSignal;
};

/** Builds the PDF; resolves with the file. Days with no readable photo still get a page that says so. */
export async function buildPhotoPack(o: PackInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 15, BOX_W = W - 2 * M, BOX_H = 105;
  const generated = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" });

  doc.setFontSize(18); doc.text("Laporan foto housekeeping", M, 30);
  doc.setFontSize(12);
  doc.text(`${o.areaCode} · ${o.areaName}`, M, 42);
  doc.text(o.customerName, M, 50);
  doc.text(`Periode ${dateLabel(o.from)} sampai ${dateLabel(o.to)}`, M, 58);
  doc.text(`${o.days.length} hari kerja dengan foto`, M, 66);
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`Dibuat ${generated} WIB. Satu halaman per hari: foto sebelum dan sesudah. T = dikerjakan terlambat. Tanpa nama petugas.`, M, 78, { maxWidth: BOX_W });
  doc.setTextColor(0);

  let done = 0;
  for (const day of o.days) {
    if (o.signal?.aborted) throw new DOMException("Dibatalkan", "AbortError");
    const picked = pickPackPhotos(await dayPhotos(o.areaId, day));
    const [before, after] = await Promise.all([picked.before ? loadPhoto(picked.before, o.signal) : null, picked.after ? loadPhoto(picked.after, o.signal) : null]);
    doc.addPage();
    doc.setFontSize(14); doc.text(`${o.areaCode} · ${dayFull(day)}`, M, 20);
    doc.setFontSize(9); doc.setTextColor(110);
    doc.text([picked.late ? "Terlambat (dikerjakan setelah harinya)" : "", picked.onBehalf ? "Dicatat oleh supervisor" : ""].filter(Boolean).join(" · "), M, 26);
    doc.setTextColor(0); doc.setFontSize(11);
    ([["Sebelum", before, 34], ["Sesudah", after, 34 + BOX_H + 14]] as const).forEach(([label, img, y]) => {
      doc.text(label, M, y - 2);
      if (!img) { doc.setTextColor(150); doc.text("Foto tidak tersedia.", M, y + 8); doc.setTextColor(0); return; }
      const f = fitBox(img.w, img.h, BOX_W, BOX_H);
      doc.addImage(img.data, "JPEG", M + (BOX_W - f.w) / 2, y, f.w, f.h);
    });
    o.onProgress?.(++done, o.days.length);
  }
  return doc.output("blob");
}

/** Hands a Blob to the browser as a download. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
