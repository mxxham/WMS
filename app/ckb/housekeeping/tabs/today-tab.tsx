"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callRpc } from "@/components/ckb/rpc-button";
import { Notice, Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { HK_STATE, dateLabel, dayLabel, lateWindowOpen, type HkState } from "@/lib/ckb/housekeeping";
import { cn } from "@/lib/utils";
import { PhotoSlots } from "../photo-slot";

export type MyDay = {
  area_id: string; area_code: string; area_name: string; customer_code: string | null; day: string; state: HkState; late: boolean;
  checkin_id: string | null; attempt: number | null; before_count: number; after_count: number; review_note: string | null;
};

/**
 * The PIC's checklist: today's racks first, then days they missed that can still be filled in late.
 * One tap on `Mulai` opens the check-in; photos, send and the late flag are handled by the database.
 */
export function PicToday({ rows, holidays, today, windowDays, maxPerKind, maxEdge }: {
  rows: MyDay[]; holidays: string[]; today: string; windowDays: number; maxPerKind: number; maxEdge: number;
}) {
  const hol = new Set(holidays);
  const todayRows = rows.filter((r) => r.day === today);
  const lateRows = rows.filter((r) => r.day < today && r.state === "MISSED" && lateWindowOpen(r.day, today, hol, windowDays))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.area_code.localeCompare(b.area_code)));
  const counted = todayRows.filter((r) => !["HOLIDAY", "LEAVE", "NA", "FUTURE"].includes(r.state));
  const done = counted.filter((r) => r.state === "DONE").length;

  if (!rows.length) {
    return <Notice tone="info" title="Belum ada area untuk Anda">Anda belum ditetapkan sebagai PIC sebuah rak atau lokasi. Minta supervisor atau admin menetapkannya di Area &amp; PIC.</Notice>;
  }
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-cond text-xl font-semibold">Hari ini · {dateLabel(today)}</h2>
          {counted.length > 0 && <p className="text-sm tabular"><b>{done}/{counted.length}</b> rak selesai</p>}
        </div>
        {counted.length > 0 && (
          <div className="h-2 overflow-hidden rounded bg-steel-100" aria-hidden><div className="h-full bg-ok" style={{ width: `${(100 * done) / counted.length}%` }} /></div>
        )}
        {todayRows.length === 0 && <Notice>Tidak ada rak untuk hari ini.</Notice>}
        {todayRows.length > 0 && counted.length === 0 && <Notice>Hari ini tidak ada housekeeping yang perlu dikirim ({HK_STATE[todayRows[0].state].label.toLowerCase()}).</Notice>}
        <div className="space-y-2">{todayRows.map((r) => <AreaRow key={`${r.area_id}|${r.day}`} r={r} today={today} maxPerKind={maxPerKind} maxEdge={maxEdge} />)}</div>
      </section>

      {lateRows.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-cond text-xl font-semibold">Belum dikirim · bisa diisi terlambat</h2>
            <p className="text-sm text-steel-500">Hari kerja sebelumnya yang terlewat, sampai {windowDays} hari kerja ke belakang. Tercatat sebagai <b>terlambat</b>.</p>
          </div>
          <div className="space-y-2">{lateRows.map((r) => <AreaRow key={`${r.area_id}|${r.day}`} r={r} today={today} maxPerKind={maxPerKind} maxEdge={maxEdge} />)}</div>
        </section>
      )}
    </div>
  );
}

function AreaRow({ r, today, maxPerKind, maxEdge }: { r: MyDay; today: string; maxPerKind: number; maxEdge: number }) {
  const router = useRouter();
  const [created, setCreated] = useState<string | null>(null);   // a check-in this row just started
  const [shown, setShown] = useState(r.state === "STARTED");   // a check-in in progress opens by itself: the photos (and any waiting to send) are what the PIC came back for
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = HK_STATE[r.state];
  const actionable = r.state === "PENDING" || r.state === "MISSED" || r.state === "REJECTED";
  const checkinId = created ?? r.checkin_id;
  const done = r.state === "DONE";
  const showPanel = !!checkinId && (created !== null || shown);

  async function start() {
    setBusy(true); setError(null);
    const [res, err] = await callRpc<{ id: string }>("ckb_hk_start", { p_area: r.area_id, p_date: r.day === today ? null : r.day, p_reason: null });
    setBusy(false);
    if (err || !res) { setError(err ?? "Gagal memulai."); return; }
    setCreated(res.id);
    router.refresh();
  }

  return (
    <div className={cn("rounded-lg border bg-white p-3", done ? "border-ok/40" : r.state === "MISSED" || r.state === "REJECTED" ? "border-bad/40" : "border-steel-100")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-cond text-xl font-bold">{r.area_code}</span>
            {r.customer_code && <span className="text-xs text-steel-500">{r.customer_code}</span>}
            <Pill tone={st.tone}>{st.mark} {st.label}</Pill>
            {r.late && done && <Pill tone="warn">Terlambat</Pill>}
            {r.day !== today && <Pill tone="neutral">{dayLabel(r.day)}</Pill>}
          </div>
          <p className="truncate text-xs text-steel-500">{r.area_name}</p>
          {(r.state === "MISSED" || r.state === "REJECTED") && r.review_note && <p className="mt-1 text-xs text-bad">Ditolak: {r.review_note}</p>}
        </div>
        <div className="flex gap-2">
          {actionable && !created && <Button size="sm" disabled={busy} onClick={() => void start()}>{busy ? "Membuka…" : r.review_note ? "Ulangi" : "Mulai"}</Button>}
          {r.state === "STARTED" && !created && <Button size="sm" onClick={() => setShown((v) => !v)}>{shown ? "Tutup" : "Lanjutkan"}</Button>}
          {done && r.checkin_id && <Button size="sm" variant="outline" onClick={() => setShown((v) => !v)}>{shown ? "Tutup" : "Lihat foto"}</Button>}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
      {showPanel && checkinId && (
        <div className="mt-3">
          <PhotoSlots checkinId={checkinId} editable={!done} maxPerKind={maxPerKind} maxEdge={maxEdge} onChanged={() => router.refresh()} />
        </div>
      )}
    </div>
  );
}
