/**
 * CKB 3PL housekeeping (migrations 0157-0158, spec docs/superpowers/specs/2026-11-24-ckb-housekeeping-design.md).
 * Pure, zero I/O. The database decides what is allowed; this file words the days, mirrors the working-day and
 * late-window rules so the page can show them before a call, and reads the paste of an Excel list.
 */
import { isUuid } from "@/lib/ckb/evidence";
import type { Tone } from "@/lib/ckb/stocktake";

/** Day states of an area, as ckb_hk_grid_core returns them (a customer only ever gets DONE, PENDING, MISSED, FUTURE, HOLIDAY, NA). */
export type HkState = "DONE" | "STARTED" | "PENDING" | "REJECTED" | "MISSED" | "FUTURE" | "HOLIDAY" | "LEAVE" | "EXCUSED" | "NA";

export const HK_STATE: Record<HkState, { label: string; tone: Tone; mark: string }> = {
  DONE: { label: "Selesai", tone: "ok", mark: "✓" },
  STARTED: { label: "Sedang dikerjakan", tone: "info", mark: "…" },
  PENDING: { label: "Belum", tone: "neutral", mark: "○" },
  REJECTED: { label: "Ditolak", tone: "bad", mark: "✕" },
  MISSED: { label: "Terlewat", tone: "bad", mark: "✕" },
  FUTURE: { label: "Belum tiba", tone: "muted", mark: "·" },
  HOLIDAY: { label: "Libur", tone: "muted", mark: "L" },
  LEAVE: { label: "Cuti", tone: "muted", mark: "C" },
  EXCUSED: { label: "Dibebaskan", tone: "muted", mark: "B" },
  NA: { label: "Tidak dijadwalkan", tone: "muted", mark: "–" },
};

export const HK_STATUS_LABEL: Record<string, string> = {
  STARTED: "Sedang dikerjakan", SUBMITTED: "Terkirim", ACCEPTED: "Diterima", REJECTED: "Ditolak", CANCELLED: "Dibatalkan", EXCUSED: "Dibebaskan",
};

// ---------------------------------------------------------------------
// Dates: ISO "YYYY-MM-DD" strings, the Jakarta calendar, no time zone surprises
// ---------------------------------------------------------------------
const MS = 86_400_000;
const ymd = (iso: string): [number, number, number] => { const [y, m, d] = iso.split("-").map(Number); return [y, m, d]; };
const toUtc = (iso: string) => { const [y, m, d] = ymd(iso); return Date.UTC(y, m - 1, d); };
export const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today's date in Jakarta. */
export const jakartaToday = (now: Date = new Date()): string => now.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
export const addDays = (iso: string, n: number): string => isoOf(toUtc(iso) + n * MS);
/** 1 = Monday ... 7 = Sunday. */
export const isoDow = (iso: string): number => { const d = new Date(toUtc(iso)).getUTCDay(); return d === 0 ? 7 : d; };
export const isWeekday = (iso: string) => isoDow(iso) <= 5;
export const isWorkday = (iso: string, holidays: ReadonlySet<string>) => isWeekday(iso) && !holidays.has(iso);
/** The Monday of the week of `iso`. */
export const weekStart = (iso: string): string => addDays(iso, 1 - isoDow(iso));
/** Monday to Friday of the week starting on `monday`. */
export const weekDays = (monday: string): string[] => [0, 1, 2, 3, 4].map((i) => addDays(monday, i));

const DAY = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const dayLabel = (iso: string) => `${DAY[isoDow(iso) - 1]} ${ymd(iso)[2]}`;
export const dateLabel = (iso: string) => `${ymd(iso)[2]} ${MONTH[ymd(iso)[1] - 1]} ${ymd(iso)[0]}`;
/** Weekday and full date for a title: "Sel, 24 Nov 2026" (dayLabel + dateLabel would print the day number twice). */
export const dayFull = (iso: string) => `${DAY[isoDow(iso) - 1]}, ${dateLabel(iso)}`;

/** Working days in [from, to], inclusive. */
export function workdaysBetween(from: string, to: string, holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, holidays)) out.push(d);
  return out;
}

/** Working days from `day` up to yesterday (yesterday, if a working day, = 1). Mirrors ckb_hk_late_rank. */
export const lateRank = (day: string, today: string, holidays: ReadonlySet<string>): number =>
  day > addDays(today, -1) ? 0 : workdaysBetween(day, addDays(today, -1), holidays).length;

/** May a PIC still fill `day` as a late entry? Mirrors the checks of ckb_hk_start for the PIC themselves. */
export function lateWindowOpen(day: string, today: string, holidays: ReadonlySet<string>, windowDays: number): boolean {
  return day < today && isWorkday(day, holidays) && lateRank(day, today, holidays) <= windowDays;
}

// ---------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------
/** Done / expected as a whole percent; null (not 100%) when nothing was expected. */
export function compliancePct(expected: number, done: number): number | null {
  return expected > 0 ? Math.round((100 * done) / expected) : null;
}
export const pctLabel = (p: number | null) => (p === null ? "–" : `${p}%`);
export const pctTone = (p: number | null): Tone => (p === null ? "muted" : p >= 95 ? "ok" : p >= 80 ? "warn" : "bad");

// ---------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------
export type HkPhotoKind = "BEFORE" | "AFTER";
export const HK_PHOTO_LABEL: Record<HkPhotoKind, string> = { BEFORE: "Sebelum", AFTER: "Sesudah" };

/**
 * The first reason a photo cannot be added now (the database checks again): a sent check-in, the cap, or an after
 * photo before any before photo. null = allowed.
 */
export function photoRuleError(a: { status: string; kind: HkPhotoKind; before: number; after: number; maxPerKind: number }): string | null {
  if (a.status !== "STARTED") return "Foto hanya bisa ditambah sebelum check-in dikirim.";
  if (a.kind === "AFTER" && a.before === 0) return "Ambil foto sebelum dulu, baru foto sesudah.";
  if ((a.kind === "BEFORE" ? a.before : a.after) >= a.maxPerKind) return `Maksimal ${a.maxPerKind} foto ${HK_PHOTO_LABEL[a.kind].toLowerCase()}.`;
  return null;
}
/** A check-in can be sent with at least one photo of each kind. */
export const canSubmit = (before: number, after: number) => before >= 1 && after >= 1;

/** The size a photo is scaled to so its long edge is at most `max` (never enlarged). */
export function fitEdge(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max || long === 0) return { w, h };
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** The size a photo takes inside a box, keeping its shape (never enlarged beyond the box). */
export function fitBox(w: number, h: number, boxW: number, boxH: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: boxW, h: boxH };
  const k = Math.min(boxW / w, boxH / h);
  return { w: w * k, h: h * k };
}

/** {customer}/HOUSEKEEPING/{check-in}/{uuid}.{ext}: ids only, nothing from the file name (the database re-checks it). */
export function hkPhotoPath(customerId: string, checkinId: string, objectId: string, mime: string): string {
  if (!isUuid(customerId) || !isUuid(checkinId) || !isUuid(objectId)) throw new Error("ID tidak valid");
  const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[mime];
  if (!ext) throw new Error("Foto harus JPG, PNG atau WebP");
  return `${customerId}/HOUSEKEEPING/${checkinId}/${objectId}.${ext}`;
}

// ---------------------------------------------------------------------
// Bulk entry: rows pasted from Excel (code, customer, PIC username)
// ---------------------------------------------------------------------
export type PasteRow = { code: string; customer: string; pic: string; name?: string };
export const PASTE_MAX_ROWS = 500;

/**
 * Reads pasted text: a tab (Excel copy), semicolon or comma between columns, in the order
 * `kode lokasi, customer, username PIC` and optionally `nama lokasi`. A first line that names the columns is skipped.
 */
export function parsePaste(text: string): { rows: PasteRow[]; error: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], error: "Tempel dulu daftarnya." };
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(";")) ? ";" : ",";
  const split = (l: string) => l.split(sep).map((c) => c.trim());
  const first = split(lines[0]);
  const header = /^(kode|code|rak|area|lokasi)/i.test(first[0] ?? "") && /(customer|pic|nama|user)/i.test(first.slice(1).join(" "));
  const body = header ? lines.slice(1) : lines;
  if (body.length > PASTE_MAX_ROWS) return { rows: [], error: `Maksimal ${PASTE_MAX_ROWS} baris sekali tempel.` };
  const rows = body.map((l) => { const c = split(l); return { code: c[0] ?? "", customer: c[1] ?? "", pic: c[2] ?? "", ...(c[3] ? { name: c[3] } : {}) }; });
  return { rows, error: rows.length ? null : "Tidak ada baris data." };
}

// ---------------------------------------------------------------------
// The grid (ckb_hk_recap rows): summaries for the supervisor's recap
// ---------------------------------------------------------------------
/** One area on one day, as ckb_hk_recap returns it. */
export type GridRow = {
  area_id: string; area_code: string; area_name: string; customer_code: string | null; pic_user_id: string | null; pic_name: string | null;
  day: string; state: HkState; late: boolean; on_behalf: boolean; checkin_id: string | null; attempt: number | null;
};

/** The days that count against compliance: done, or missed. Mirrors ckb_hk_compliance (a day not over counts only once done). */
export const isExpected = (s: HkState) => s === "DONE" || s === "MISSED";

export type GridSummary = { expected: number; done: number; missed: number; late: number; started: number; excused: number; pct: number | null };
export function summarizeGrid(rows: readonly GridRow[]): GridSummary {
  const done = rows.filter((r) => r.state === "DONE").length, missed = rows.filter((r) => r.state === "MISSED").length;
  return {
    expected: done + missed, done, missed, late: rows.filter((r) => r.state === "DONE" && r.late).length,
    started: rows.filter((r) => r.state === "STARTED").length, excused: rows.filter((r) => r.state === "EXCUSED").length, pct: compliancePct(done + missed, done),
  };
}

export type PicSummary = GridSummary & { pic_user_id: string; pic_name: string; areas: number };
/** Per PIC, sorted with the worst compliance first. */
export function perPic(rows: readonly GridRow[]): PicSummary[] {
  const by = new Map<string, GridRow[]>();
  for (const r of rows) if (r.pic_user_id) by.set(r.pic_user_id, [...(by.get(r.pic_user_id) ?? []), r]);
  return [...by.entries()].map(([id, rs]) => ({ ...summarizeGrid(rs), pic_user_id: id, pic_name: rs.find((r) => r.pic_name)?.pic_name ?? "?", areas: new Set(rs.map((r) => r.area_id)).size }))
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || b.missed - a.missed || a.pic_name.localeCompare(b.pic_name));
}

/** Areas with at least one missed or rejected day in the rows. */
export function problemAreaIds(rows: readonly GridRow[]): Set<string> {
  return new Set(rows.filter((r) => r.state === "MISSED" || r.state === "REJECTED").map((r) => r.area_id));
}

export type Reminder = { pic_user_id: string; pic_name: string; areas: string[]; started: number };
/** PICs who still have racks to send today: not started, started but not sent, or rejected. Empty on a day that is not a working day. */
export function reminders(rows: readonly GridRow[], today: string): Reminder[] {
  const open = rows.filter((r) => r.day === today && r.pic_user_id && (r.state === "PENDING" || r.state === "STARTED" || r.state === "REJECTED"));
  const by = new Map<string, Reminder>();
  for (const r of open) {
    const cur = by.get(r.pic_user_id!) ?? { pic_user_id: r.pic_user_id!, pic_name: r.pic_name ?? "?", areas: [], started: 0 };
    cur.areas.push(r.area_code); if (r.state === "STARTED") cur.started++;
    by.set(r.pic_user_id!, cur);
  }
  return [...by.values()].map((x) => ({ ...x, areas: x.areas.sort() })).sort((a, b) => b.areas.length - a.areas.length || a.pic_name.localeCompare(b.pic_name));
}

// ---------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------
export const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;
export const addMonths = (iso: string, n: number): string => {
  const [y, m] = ymd(monthStart(iso));
  return isoOf(Date.UTC(y, m - 1 + n, 1));
};
export const monthEnd = (iso: string) => addDays(addMonths(iso, 1), -1);
const MONTH_FULL = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const monthLabel = (iso: string) => `${MONTH_FULL[ymd(iso)[1] - 1]} ${ymd(iso)[0]}`;

/** The Monday-to-Friday weeks that cover a month; a day outside the month is null. */
export function monthWeeks(iso: string): (string | null)[][] {
  const first = monthStart(iso), last = monthEnd(iso);
  const weeks: (string | null)[][] = [];
  for (let mon = weekStart(first); mon <= last; mon = addDays(mon, 7)) weeks.push(weekDays(mon).map((d) => (d >= first && d <= last ? d : null)));
  return weeks;
}

/** Per day: how many racks were expected and done (customer view; uses the customer-safe cells). */
export function dayRatios(cells: readonly { day: string; state: HkState }[]): Map<string, { expected: number; done: number }> {
  const m = new Map<string, { expected: number; done: number }>();
  for (const c of cells) {
    if (!isExpected(c.state)) continue;
    const cur = m.get(c.day) ?? { expected: 0, done: 0 };
    cur.expected++; if (c.state === "DONE") cur.done++;
    m.set(c.day, cur);
  }
  return m;
}

// ---------------------------------------------------------------------
// Photo pack: one rack, one week or month, one page per done day
// ---------------------------------------------------------------------
export const PACK_MAX_DAYS = 31;
export type PackPhoto = { kind: HkPhotoKind; photo_id: string; uploaded_at: string; late: boolean; on_behalf: boolean };
/** From the photos of one day: the first before photo and the last after photo (what the page shows), and the day's marks. */
export function pickPackPhotos(photos: readonly PackPhoto[]): { before: string | null; after: string | null; late: boolean; onBehalf: boolean } {
  const by = (k: HkPhotoKind) => photos.filter((p) => p.kind === k).sort((a, b) => (a.uploaded_at < b.uploaded_at ? -1 : a.uploaded_at > b.uploaded_at ? 1 : 0));
  const b = by("BEFORE"), a = by("AFTER");
  return { before: b[0]?.photo_id ?? null, after: a[a.length - 1]?.photo_id ?? null, late: photos.some((p) => p.late), onBehalf: photos.some((p) => p.on_behalf) };
}
/** The done days of a period, oldest first, at most PACK_MAX_DAYS (the latest ones when there are more). */
export function packDays(cells: readonly { day: string; state: HkState }[], from: string, to: string): { days: string[]; cut: boolean } {
  const all = [...new Set(cells.filter((c) => c.state === "DONE" && c.day >= from && c.day <= to).map((c) => c.day))].sort();
  return { days: all.slice(-PACK_MAX_DAYS), cut: all.length > PACK_MAX_DAYS };
}

/** A timestamp as Jakarta wall-clock time: the same text on the server (UTC) and in the browser. */
export function hkDateTime(ts: string | null | undefined): string {
  if (!ts) return "–";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
