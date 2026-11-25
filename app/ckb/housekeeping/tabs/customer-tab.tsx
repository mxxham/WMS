"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Images } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Pill, StatTile } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { buildPhotoPack, saveBlob } from "@/lib/ckb/hk-photo-pack";
import {
  HK_PHOTO_LABEL, HK_STATE, addDays, addMonths, compliancePct, dateLabel, dayFull, dayLabel, dayRatios, monthEnd, monthLabel, monthStart, monthWeeks, packDays,
  pctLabel, pctTone, weekDays, weekStart, type HkPhotoKind, type HkState,
} from "@/lib/ckb/housekeeping";
import { cn } from "@/lib/utils";
import { Lightbox } from "../lightbox";
import { CustomerQuality, type CustomerFinding, type QualityCell } from "./customer-quality";
import { HkThumb } from "../photo-slot";

export type WeekCell = { area_id: string; area_code: string; area_name: string; day: string; state: HkState; late: boolean; on_behalf: boolean };
export type Compliance = { area_id: string; expected: number; done: number; late: number };
type DayPhoto = { photo_id: string; kind: HkPhotoKind; late: boolean; on_behalf: boolean };

/**
 * What a customer sees of housekeeping: racks day by day, the compliance of the week and the month, the before and after
 * photos of every done day, and the report to hand over (numbers as Excel or PDF, and a photo pack per rack). No person's
 * name appears anywhere: the database never sends one.
 */
export function CustomerTab({ customerId, customerName, customers, monday, month, cells, monthCells, week, monthComp, today, quality, findings }: {
  customerId: string; customerName: string; customers: { id: string; name: string }[]; monday: string; month: string;
  cells: WeekCell[]; monthCells: WeekCell[]; week: Compliance[]; monthComp: Compliance[]; today: string; quality: QualityCell[]; findings: CustomerFinding[];
}) {
  const days = weekDays(monday);
  const [open, setOpen] = useState<{ area: WeekCell; day: string } | null>(null);
  const [photos, setPhotos] = useState<DayPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [light, setLight] = useState<{ items: { id: string; caption: string }[]; index: number } | null>(null);

  const areas = [...new Map(cells.map((c) => [c.area_id, c])).values()].sort((a, b) => a.area_code.localeCompare(b.area_code));
  const byKey = new Map(cells.map((c) => [`${c.area_id}|${c.day}`, c]));
  const wk = new Map(week.map((c) => [c.area_id, c])), mo = new Map(monthComp.map((c) => [c.area_id, c]));
  const sum = (m: Compliance[]) => ({ expected: m.reduce((t, c) => t + c.expected, 0), done: m.reduce((t, c) => t + c.done, 0), late: m.reduce((t, c) => t + c.late, 0) });
  const w = sum(week), mth = sum(monthComp);
  const q = (m: string, mo2: string, c = customerId) => `/ckb/housekeeping?c=${c}&week=${m}&month=${mo2}`;
  const ratios = dayRatios(monthCells);

  async function show(area: WeekCell, day: string) {
    if (open?.area.area_id === area.area_id && open.day === day) { setOpen(null); return; }
    setOpen({ area, day }); setPhotos(null); setError(null);
    const { data, error: err } = await createClient().rpc("ckb_hk_customer_day", { p_area: area.area_id, p_day: day });
    if (err) { setError(err.message); return; }
    setPhotos((data ?? []) as DayPhoto[]);
  }

  const report = (format: "xlsx" | "pdf") => `/api/ckb/reports?kind=housekeeping&format=${format}&customer=${customerId}&from=${monthStart(month)}&to=${monthEnd(month) > today ? today : monthEnd(month)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link href={q(addDays(monday, -7), month)} aria-label="Minggu sebelumnya"><ChevronLeft className="h-4 w-4" /></Link></Button>
          <p className="font-cond text-lg font-semibold">{dateLabel(days[0])} – {dateLabel(days[4])}</p>
          <Button asChild variant="outline" size="sm"><Link href={q(addDays(monday, 7), month)} aria-label="Minggu berikutnya"><ChevronRight className="h-4 w-4" /></Link></Button>
        </div>
        {customers.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {customers.map((c) => (
              <Link key={c.id} href={q(monday, month, c.id)} className={cn("rounded-md border px-3 py-1.5 text-sm", c.id === customerId ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white hover:bg-steel-100")}>{c.name}</Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Kepatuhan minggu ini" value={pctLabel(compliancePct(w.expected, w.done))} hint={`${w.done} dari ${w.expected} hari kerja`} />
        <StatTile label={`Kepatuhan ${monthLabel(month)}`} value={pctLabel(compliancePct(mth.expected, mth.done))} hint={`${mth.done} dari ${mth.expected} hari kerja`} />
        <StatTile label="Terlambat bulan ini" value={mth.late} hint="dikerjakan setelah harinya" />
        <StatTile label="Rak dan lokasi" value={areas.length} hint={customerName} />
      </div>

      {areas.length === 0 ? <p className="rounded-lg border border-dashed border-steel-300 bg-white p-6 text-center text-sm text-steel-500">Belum ada rak atau lokasi housekeeping untuk {customerName}.</p> : (
        <div className="overflow-x-auto rounded-lg border border-steel-100 bg-white">
          <Table>
            <thead><tr>
              <Th>Rak / lokasi</Th>{days.map((d) => <Th key={d} className="text-center">{dayLabel(d)}</Th>)}<Th className="text-right">Minggu ini</Th><Th className="text-right">{monthLabel(month)}</Th>
            </tr></thead>
            <tbody>{areas.map((a) => {
              const cw = wk.get(a.area_id), cm = mo.get(a.area_id);
              const pw = cw ? compliancePct(cw.expected, cw.done) : null, pm = cm ? compliancePct(cm.expected, cm.done) : null;
              return (
                <tr key={a.area_id}>
                  <Td><span className="font-cond text-lg font-bold">{a.area_code}</span><div className="text-xs text-steel-500">{a.area_name}</div></Td>
                  {days.map((d) => {
                    const c = byKey.get(`${a.area_id}|${d}`);
                    if (!c) return <Td key={d} className="text-center text-steel-300">–</Td>;
                    const st = HK_STATE[c.state];
                    const clickable = c.state === "DONE";
                    return (
                      <Td key={d} className="text-center">
                        {clickable
                          ? <button type="button" onClick={() => void show(c, d)} aria-label={`Foto ${a.area_code} ${dayLabel(d)}`} className="rounded focus:outline-none focus:ring-2 focus:ring-ckb"><Pill tone={st.tone}>{st.mark}{c.late ? " T" : ""}</Pill></button>
                          : <Pill tone={st.tone}>{st.mark}</Pill>}
                        <div className="text-[11px] text-steel-500">{clickable ? (c.late ? "terlambat" : "foto") : st.label}</div>
                      </Td>
                    );
                  })}
                  <Td className="text-right"><Pill tone={pctTone(pw)}>{pctLabel(pw)}</Pill></Td>
                  <Td className="text-right"><Pill tone={pctTone(pm)}>{pctLabel(pm)}</Pill></Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </div>
      )}

      {open && (
        <div className="space-y-3 rounded-lg border border-steel-100 bg-white p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-cond text-lg font-semibold">{open.area.area_code} · {dayFull(open.day)}</p>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Tutup</Button>
          </div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          {!photos && !error && <p className="text-sm text-steel-500">Memuat foto…</p>}
          {photos && photos.length === 0 && <p className="text-sm text-steel-500">Tidak ada foto.</p>}
          {photos && photos.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {photos[0].late && <Pill tone="warn">Terlambat</Pill>}
                {photos[0].on_behalf && <Pill tone="neutral">Dicatat oleh supervisor</Pill>}
              </div>
              {(["BEFORE", "AFTER"] as HkPhotoKind[]).map((k) => (
                <div key={k} className="space-y-1">
                  <p className="text-sm font-semibold">{HK_PHOTO_LABEL[k]}</p>
                  <div className="flex flex-wrap gap-2">
                    {photos.filter((p) => p.kind === k).map((p) => (
                      <HkThumb key={p.photo_id} id={p.photo_id} label={`Foto ${HK_PHOTO_LABEL[k].toLowerCase()}`}
                        onClick={() => setLight({ items: photos.map((x) => ({ id: x.photo_id, caption: `${open.area.area_code} · ${dateLabel(open.day)} · Foto ${HK_PHOTO_LABEL[x.kind].toLowerCase()}` })), index: photos.findIndex((x) => x.photo_id === p.photo_id) })} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-cond text-xl font-semibold">{monthLabel(month)}</h2>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link href={q(monday, addMonths(month, -1))} aria-label="Bulan sebelumnya"><ChevronLeft className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={q(monday, addMonths(month, 1))} aria-label="Bulan berikutnya"><ChevronRight className="h-4 w-4" /></Link></Button>
          </div>
        </div>
        <MonthCalendar month={month} ratios={ratios} today={today} onPick={(d) => { const mon = weekStart(d); if (mon !== monday) window.location.href = q(mon, month); }} />
      </section>

      <CustomerQuality cells={quality} findings={findings} today={today} />

      <section className="space-y-3 rounded-lg border border-steel-100 bg-white p-4">
        <h2 className="font-cond text-xl font-semibold">Laporan</h2>
        <p className="text-sm text-steel-500">Angka kepatuhan per rak dan hari untuk {monthLabel(month)} (sampai hari ini), tanpa nama petugas.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={report("xlsx")}><Download className="h-4 w-4" />Excel</a></Button>
          <Button asChild variant="outline"><a href={report("pdf")}><Download className="h-4 w-4" />PDF</a></Button>
        </div>
        <PhotoPack areas={areas} customerName={customerName} monday={monday} month={month} today={today} cells={monthCells} weekCells={cells} />
      </section>
      <p className="text-xs text-steel-500">✓ selesai · T terlambat (dikerjakan setelah harinya) · ✕ terlewat · ○ belum · L libur · – tidak dijadwalkan. Kepatuhan = hari selesai ÷ hari yang seharusnya.</p>
      {light && <Lightbox items={light.items} index={light.index} onIndex={(i) => setLight((l) => (l ? { ...l, index: i } : l))} onClose={() => setLight(null)} />}
    </div>
  );
}

/** Monday-to-Friday calendar of the month; each day shows how many racks were done of those expected. */
function MonthCalendar({ month, ratios, today, onPick }: { month: string; ratios: Map<string, { expected: number; done: number }>; today: string; onPick: (day: string) => void }) {
  const weeks = monthWeeks(month);
  return (
    <div className="grid grid-cols-5 gap-1.5" role="grid" aria-label={`Kalender ${monthLabel(month)}`}>
      {["Sen", "Sel", "Rab", "Kam", "Jum"].map((d) => <p key={d} className="text-center text-xs font-semibold text-steel-500">{d}</p>)}
      {weeks.flat().map((d, i) => {
        if (!d) return <div key={i} />;
        const r = ratios.get(d);
        const tone = !r ? "border-steel-100 bg-paper text-steel-300" : r.done === r.expected ? "border-ok/40 bg-ok/10" : r.done === 0 ? "border-bad/40 bg-bad/10" : "border-warn/40 bg-warn/10";
        return (
          <button key={d} type="button" disabled={d > today} onClick={() => onPick(d)} aria-label={`${dateLabel(d)}${r ? `: ${r.done} dari ${r.expected} rak` : ""}`}
            className={cn("rounded-md border p-1.5 text-left text-xs tabular", tone, d === today && "ring-2 ring-ckb")}>
            <span className="block font-semibold">{Number(d.slice(8))}</span>
            <span className="block text-[11px]">{r ? `${r.done}/${r.expected}` : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One rack, one week or one month, as a PDF with a page per done day. Built in the browser, so a month of photos fits. */
function PhotoPack({ areas, customerName, monday, month, today, cells, weekCells }: {
  areas: WeekCell[]; customerName: string; monday: string; month: string; today: string; cells: WeekCell[]; weekCells: WeekCell[];
}) {
  const [area, setArea] = useState("");
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const a = areas.find((x) => x.area_id === area);
  const from = period === "week" ? monday : monthStart(month), to = period === "week" ? addDays(monday, 4) : (monthEnd(month) > today ? today : monthEnd(month));
  const src = period === "week" ? weekCells : cells;
  const plan = a ? packDays(src.filter((c) => c.area_id === a.area_id), from, to) : { days: [], cut: false };

  async function run() {
    if (!a) return;
    setError(null); setNote(null); setProgress({ done: 0, total: plan.days.length });
    try {
      const blob = await buildPhotoPack({ areaId: a.area_id, areaCode: a.area_code, areaName: a.area_name, customerName, from, to, days: plan.days, onProgress: (done, total) => setProgress({ done, total }) });
      saveBlob(blob, `housekeeping_${a.area_code}_${from}_${to}.pdf`);
      setNote(`Selesai: ${plan.days.length} halaman foto.`);
    } catch (e) { setError((e as Error).message || "Gagal membuat PDF."); }
    finally { setProgress(null); }
  }

  return (
    <div className="space-y-2 border-t border-steel-100 pt-3">
      <p className="font-semibold">Foto per rak</p>
      <p className="text-sm text-steel-500">Satu PDF untuk satu rak: satu halaman per hari yang selesai, foto sebelum dan sesudah berdampingan.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Select aria-label="Pilih rak" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Pilih rak…</option>{areas.map((x) => <option key={x.area_id} value={x.area_id}>{x.area_code} · {x.area_name}</option>)}
        </Select>
        <Select aria-label="Periode" value={period} onChange={(e) => setPeriod(e.target.value as "week" | "month")}>
          <option value="week">Minggu {dateLabel(monday)}</option><option value="month">{monthLabel(month)}</option>
        </Select>
        <Button disabled={!a || plan.days.length === 0 || progress !== null} onClick={() => void run()}>
          <Images className="h-4 w-4" />{progress ? `Membuat ${progress.done}/${progress.total}…` : "Buat PDF foto"}
        </Button>
      </div>
      {a && plan.days.length === 0 && <p className="text-xs text-steel-500">Tidak ada hari selesai pada periode ini.</p>}
      {plan.cut && <p className="text-xs text-warn">Lebih dari 31 hari: hanya 31 hari terakhir yang dimasukkan.</p>}
      {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
      {note && <p className="text-sm text-ok">{note}</p>}
    </div>
  );
}
