"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { callRpc } from "@/components/ckb/rpc-button";
import { Pill, StatTile } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import {
  HK_STATE, addDays, dateLabel, dayFull, dayLabel, hkDateTime as fmtDateTime, pctLabel, perPic, problemAreaIds, reminders, summarizeGrid, weekDays, type GridRow, type HkPhotoKind,
} from "@/lib/ckb/housekeeping";
import { cn } from "@/lib/utils";
import { DayPanel, type DayTarget } from "../day-panel";
import { Lightbox } from "../lightbox";
import { HkThumb } from "../photo-slot";

export type QueueItem = {
  id: string; work_date: string; attempt: number; late: boolean; on_behalf_by: string | null; pic_name: string; submitted_at: string | null; area_id: string;
  ckb_hk_areas: { code: string; name: string } | null; ckb_hk_photos: { id: string; kind: HkPhotoKind; withdrawn_at: string | null }[];
};

const chip = (on: boolean) => cn("rounded-md border px-3 py-1.5 text-sm", on ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white hover:bg-steel-100");

/** The supervisor's page: KPI strip, the week grid (every cell opens the day), the review queue with bulk accept, and who still owes a rack today. */
export function RecapTab({ monday, today, rows, queue, queueTotal, customers, customerId, maxPerKind, maxEdge }: {
  monday: string; today: string; rows: GridRow[]; queue: QueueItem[]; queueTotal: number; customers: { id: string; name: string }[]; customerId: string | null;
  maxPerKind: number; maxEdge: number;
}) {
  const days = weekDays(monday);
  const [pic, setPic] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<DayTarget | null>(null);
  const href = (m: string, c: string | null = customerId) => `/ckb/housekeeping?tab=recap&week=${m}${c ? `&c=${c}` : ""}`;

  const pics = useMemo(() => perPic(rows), [rows]);
  const problems = useMemo(() => problemAreaIds(rows), [rows]);
  const sum = useMemo(() => summarizeGrid(rows), [rows]);
  const owing = useMemo(() => reminders(rows, today), [rows, today]);
  const picOf = (areaId: string) => rows.find((r) => r.area_id === areaId && r.pic_name)?.pic_name ?? null;
  const everyArea = [...new Map(rows.map((r) => [r.area_id, r])).values()].sort((a, b) => a.area_code.localeCompare(b.area_code));
  // An area with nothing scheduled all week (no customer or no PIC yet) is hidden until asked for: a synced rack list is long.
  const scheduled = new Set(rows.filter((r) => r.state !== "NA").map((r) => r.area_id));
  const hidden = everyArea.filter((a) => !scheduled.has(a.area_id)).length;
  const areas = everyArea.filter((a) => (showAll || scheduled.has(a.area_id))).filter((a) => (!pic || rows.some((r) => r.area_id === a.area_id && r.pic_user_id === pic)) && (!onlyProblems || problems.has(a.area_id)));
  const cell = new Map(rows.map((r) => [`${r.area_id}|${r.day}`, r]));
  const target = (a: GridRow, day: string): DayTarget => ({ areaId: a.area_id, areaCode: a.area_code, areaName: a.area_name, day, isLead: true });

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Kepatuhan minggu ini" value={pctLabel(sum.pct)} hint={`${sum.done} dari ${sum.expected} hari kerja`} />
        <StatTile label="Terlewat" value={sum.missed} hint={sum.late ? `${sum.late} selesai terlambat` : "minggu ini"} />
        <StatTile label="Menunggu tinjauan" value={queueTotal} hint="sudah dikirim, belum ditinjau" />
        <StatTile label="Belum dikirim hari ini" value={owing.reduce((n, o) => n + o.areas.length, 0)} hint={`${owing.length} PIC`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link href={href(addDays(monday, -7))} aria-label="Minggu sebelumnya"><ChevronLeft className="h-4 w-4" /></Link></Button>
          <p className="font-cond text-lg font-semibold">{dateLabel(days[0])} – {dateLabel(days[4])}</p>
          <Button asChild variant="outline" size="sm"><Link href={href(addDays(monday, 7))} aria-label="Minggu berikutnya"><ChevronRight className="h-4 w-4" /></Link></Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Link href={href(monday, null)} className={chip(!customerId)}>Semua customer</Link>
          {customers.map((c) => <Link key={c.id} href={href(monday, c.id)} className={chip(c.id === customerId)}>{c.name}</Link>)}
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-cond text-xl font-semibold">Rekap minggu ini</h2>
          <select aria-label="Filter PIC" value={pic} onChange={(e) => setPic(e.target.value)} className="h-9 rounded-md border border-steel-300 bg-white px-2 text-sm">
            <option value="">Semua PIC</option>{pics.map((p) => <option key={p.pic_user_id} value={p.pic_user_id}>{p.pic_name} · {pctLabel(p.pct)}</option>)}
          </select>
          <button type="button" aria-pressed={onlyProblems} className={chip(onlyProblems)} onClick={() => setOnlyProblems((v) => !v)}>Hanya bermasalah · {problems.size}</button>
          {hidden > 0 && <button type="button" aria-pressed={showAll} className={chip(showAll)} onClick={() => setShowAll((v) => !v)}>{showAll ? "Sembunyikan" : "Tampilkan"} {hidden} area tanpa jadwal</button>}
        </div>
        {areas.length === 0 ? <p className="text-sm text-steel-500">Tidak ada area yang cocok.</p> : (
          <div className="overflow-x-auto rounded-lg border border-steel-100 bg-white">
            <Table>
              <thead><tr><Th className="sticky left-0 bg-white">Area</Th><Th>PIC</Th>{days.map((d) => <Th key={d} className={cn("text-center", d === today && "bg-ckb-tint/40")}>{dayLabel(d)}</Th>)}</tr></thead>
              <tbody>{areas.map((a) => (
                <tr key={a.area_id}>
                  <Td className="sticky left-0 bg-white"><span className="font-cond text-lg font-bold">{a.area_code}</span> <span className="text-xs text-steel-500">{a.customer_code}</span><div className="text-xs text-steel-500">{a.area_name}</div></Td>
                  <Td className="text-sm">{picOf(a.area_id) ?? <span className="text-warn">belum ada PIC</span>}</Td>
                  {days.map((d) => {
                    const c = cell.get(`${a.area_id}|${d}`);
                    if (!c) return <Td key={d} className="text-center text-steel-300">–</Td>;
                    const st = HK_STATE[c.state];
                    const inert = ["FUTURE", "HOLIDAY", "LEAVE", "NA"].includes(c.state);
                    const body = (
                      <>
                        <Pill tone={st.tone}>{st.mark}{c.late && c.state === "DONE" ? " T" : ""}{c.on_behalf ? " ∗" : ""}</Pill>
                        <div className="text-[11px] text-steel-500">{st.label}{c.attempt && c.attempt > 1 ? ` (ke-${c.attempt})` : ""}</div>
                      </>
                    );
                    return (
                      <Td key={d} className={cn("text-center", d === today && "bg-ckb-tint/40")}>
                        {inert ? body : <button type="button" onClick={() => setOpen(target(a, d))} aria-label={`Buka ${a.area_code} ${dayLabel(d)}`} className="rounded focus:outline-none focus:ring-2 focus:ring-ckb">{body}</button>}
                      </Td>
                    );
                  })}
                </tr>
              ))}</tbody>
            </Table>
          </div>
        )}
        <p className="text-xs text-steel-500">T terlambat · ∗ dicatat atas nama PIC · ✕ terlewat · B dibebaskan · C cuti · L libur · – belum ada PIC pada hari itu. Klik sebuah hari untuk membuka foto dan tindakannya.</p>
      </section>

      <Reminders owing={owing} today={today} />
      <Review queue={queue} total={queueTotal} onOpen={(q) => q.ckb_hk_areas && setOpen({ areaId: q.area_id, areaCode: q.ckb_hk_areas.code, areaName: q.ckb_hk_areas.name, day: q.work_date, isLead: true })} />
      <DayPanel target={open} onClose={() => setOpen(null)} maxPerKind={maxPerKind} maxEdge={maxEdge} />
    </div>
  );
}

/** PICs with racks still to send today. In-app only: it tells the supervisor whom to call, it sends nothing. */
function Reminders({ owing, today }: { owing: ReturnType<typeof reminders>; today: string }) {
  return (
    <section className="space-y-2">
      <h2 className="font-cond text-xl font-semibold">Pengingat · belum dikirim hari ini</h2>
      {owing.length === 0 ? <p className="rounded-lg border border-dashed border-steel-300 bg-white p-4 text-sm text-steel-500">Tidak ada rak yang menunggu pada {dateLabel(today)} (atau bukan hari kerja).</p> : (
        <ul className="divide-y divide-steel-100 rounded-lg border border-steel-100 bg-white">
          {owing.map((o) => (
            <li key={o.pic_user_id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span><b>{o.pic_name}</b> · {o.areas.length} rak</span>
              <span className="text-steel-500">{o.areas.join(", ")}{o.started ? ` · ${o.started} sedang dikerjakan` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Review({ queue, total, onOpen }: { queue: QueueItem[]; total: number; onOpen: (q: QueueItem) => void }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [light, setLight] = useState<{ items: { id: string; caption: string }[]; index: number } | null>(null);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function acceptPicked() {
    setBusy(true); setError(null);
    const failed: string[] = [];
    for (const id of picked) {
      const [, err] = await callRpc("ckb_hk_review", { p_checkin: id, p_accept: true, p_note: null });
      if (err) failed.push(err);
    }
    setBusy(false); setPicked(new Set());
    if (failed.length) setError(`${failed.length} gagal: ${failed[0]}`);
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-cond text-xl font-semibold">Menunggu tinjauan · {total}</h2>
        {queue.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPicked(picked.size === queue.length ? new Set() : new Set(queue.map((q) => q.id)))}>{picked.size === queue.length ? "Lepas semua" : "Pilih semua"}</Button>
            <Button size="sm" disabled={picked.size === 0 || busy} onClick={() => void acceptPicked()}>{busy ? "Memproses…" : `Terima yang dipilih (${picked.size})`}</Button>
          </div>
        )}
      </div>
      <p className="text-sm text-steel-500">Yang sudah dikirim terhitung selesai. Tolak bila fotonya tidak menunjukkan raknya atau sama dengan foto lain. Anda tidak bisa meninjau pekerjaan Anda sendiri.</p>
      {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
      {queue.length === 0 && <p className="rounded-lg border border-dashed border-steel-300 bg-white p-5 text-center text-sm text-steel-500">Semua sudah ditinjau.</p>}
      {total > queue.length && <p className="text-xs text-warn">Menampilkan {queue.length} tertua dari {total}. Tinjau dulu lalu muat ulang.</p>}
      <div className="space-y-2">
        {queue.map((q) => {
          const ph = q.ckb_hk_photos.filter((p) => !p.withdrawn_at);
          const items = ph.map((p) => ({ id: p.id, caption: `${q.ckb_hk_areas?.code ?? ""} · ${dateLabel(q.work_date)}` }));
          return (
            <div key={q.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-steel-100 bg-white p-3">
              <input type="checkbox" checked={picked.has(q.id)} onChange={() => toggle(q.id)} aria-label={`Pilih ${q.ckb_hk_areas?.code ?? ""} ${q.work_date}`} className="h-5 w-5" />
              <div className="min-w-40 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-cond text-lg font-bold">{q.ckb_hk_areas?.code ?? "?"}</span>
                  <span className="text-sm">{dayFull(q.work_date)}</span>
                  {q.late && <Pill tone="warn">Terlambat</Pill>}
                  {q.on_behalf_by && <Pill tone="neutral">Atas nama</Pill>}
                  {q.attempt > 1 && <Pill tone="neutral">Ke-{q.attempt}</Pill>}
                </div>
                <p className="text-xs text-steel-500">{q.pic_name}{q.submitted_at ? ` · dikirim ${fmtDateTime(q.submitted_at)}` : ""}</p>
              </div>
              <div className="flex gap-1">
                {ph.slice(0, 4).map((p, i) => <HkThumb key={p.id} id={p.id} className="h-14 w-14" label={`Foto ${i + 1}`} onClick={() => setLight({ items, index: i })} />)}
              </div>
              <Button size="sm" variant="outline" onClick={() => onOpen(q)}>Buka</Button>
            </div>
          );
        })}
      </div>
      {light && <Lightbox items={light.items} index={light.index} onIndex={(i) => setLight((l) => (l ? { ...l, index: i } : l))} onClose={() => setLight(null)} />}
    </section>
  );
}
