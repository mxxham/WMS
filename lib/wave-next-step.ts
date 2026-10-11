/**
 * The Wave page's guidance (redesign, spec §1.1 and §1.3): for every wave one plain sentence saying
 * what to do now and the one primary button that does it, and for the day the single most urgent
 * thing. Pure: the page passes facts in, gets words and an action back.
 */

export type WaveFacts = {
  id: string; wave_no: string; planned_slot: string | null;
  status: "PENDING" | "RESCHEDULED" | "COMPLETED" | "CANCELLED";
  /** live tasks still PLANNED */
  open: number;
  /** live tasks (not cancelled) */
  total: number;
  /** open tasks stok kurang or waiting for a Bin To Bin */
  blocked: number;
  finishedAt?: string | null;
  cancelledAt?: string | null;
  audit?: { done: number; total: number } | null;
};

export type Primary = "mulai" | "lihat" | "tutup" | "aktifkan" | null;
export type NextStep = { tone: "normal" | "bad" | "muted"; text: string; primary: Primary };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).replace(":", ".");

export function waveNextStep(w: WaveFacts): NextStep {
  switch (w.status) {
    case "RESCHEDULED":
      return { tone: "muted", text: "Ditunda. Aktifkan untuk lanjut.", primary: "aktifkan" };
    case "COMPLETED": {
      const at = w.finishedAt ? ` ${clock(w.finishedAt)}` : "";
      const audit = w.audit ? ` Audit ${w.audit.done}/${w.audit.total} shipment.` : "";
      return { tone: "muted", text: `Selesai${at}.${audit}`, primary: null };
    }
    case "CANCELLED":
      return { tone: "muted", text: `Dibatalkan${w.cancelledAt ? ` ${clock(w.cancelledAt)}` : ""}.`, primary: null };
    default:
      if (w.open === 0) return { tone: "normal", text: "Semua baris sudah diposting: tutup wave.", primary: "tutup" };
      if (w.blocked > 0) return { tone: "bad", text: `${w.blocked} baris tertahan: perbaiki dulu.`, primary: "lihat" };
      return { tone: "normal", text: `Mulai picking: ${w.open} baris belum diambil.`, primary: "mulai" };
  }
}

/** "NO 7", "NO 7 dan NO 8", "NO 1, NO 2 dan NO 3" — each wave once, by number. */
function waveList(nos: string[]): string {
  const names = [...new Set(nos)].sort((a, b) => (Number(a.replace(/\D/g, "")) || 0) - (Number(b.replace(/\D/g, "")) || 0)).map((n) => `NO ${n}`);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} dan ${names[names.length - 1]}`;
}

const running = (w: WaveFacts) => w.status === "PENDING" || w.status === "RESCHEDULED";
const slotKey = (w: WaveFacts) => w.planned_slot ?? "99:99";
const noKey = (w: WaveFacts) => Number(w.wave_no.replace(/\D/g, "")) || 0;
const rank = (w: WaveFacts) => (running(w) ? 0 : w.status === "COMPLETED" ? 1 : 2);

/** Running waves by slot (no slot last) then NO, then finished, then cancelled. */
export function waveOrder(waves: WaveFacts[]): WaveFacts[] {
  return [...waves].sort((a, b) => rank(a) - rank(b) || slotKey(a).localeCompare(slotKey(b)) || noKey(a) - noKey(b));
}

export type DayFacts = { short: { wave_no: string }[]; requests: number; waiting: { wave_no: string }[] };
export type DayStep = { text: string; target: { kind: "problems" } | { kind: "wave"; id: string } | null };

/** The single most urgent thing on the day, in a fixed priority. */
export function dayNextStep(waves: WaveFacts[], d: DayFacts): DayStep {
  if (d.short.length > 0) {
    return { text: `${d.short.length} baris stok kurang di ${waveList(d.short.map((s) => s.wave_no))} harus diperbaiki dulu.`, target: { kind: "problems" } };
  }
  if (d.requests > 0) return { text: `${d.requests} permintaan dari picker menunggu supervisor.`, target: { kind: "problems" } };
  if (d.waiting.length > 0) {
    return { text: `${d.waiting.length} baris menunggu Bin To Bin di ${waveList(d.waiting.map((s) => s.wave_no))}.`, target: { kind: "problems" } };
  }
  const next = waveOrder(waves).find((w) => w.status === "PENDING" && w.open > 0);
  if (next) {
    return { text: `Mulai NO ${next.wave_no}${next.planned_slot ? ` (${next.planned_slot})` : ""}: ${next.open} baris.`, target: { kind: "wave", id: next.id } };
  }
  if (waves.length === 0) return { text: "Belum ada rencana untuk hari ini.", target: null };
  return { text: "Semua wave hari ini selesai.", target: null };
}
