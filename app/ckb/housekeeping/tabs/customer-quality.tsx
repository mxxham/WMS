"use client";
import { useMemo, useState } from "react";
import { Pill, StatTile } from "@/components/ckb/ui";
import { Table, Td, Th } from "@/components/ui/table";
import { dateLabel, pctLabel } from "@/lib/ckb/housekeeping";
import { FINDING_STATE, countFindings, lastWeeks, scoreTone, trend, trendLabel, type CustomerFindingStatus } from "@/lib/ckb/hk-quality";
import { cn } from "@/lib/utils";
import { Lightbox } from "../lightbox";
import { HkThumb } from "../photo-slot";

export type QualityCell = { area_id: string; area_code: string; area_name: string; week_start: string; pct: number };
export type CustomerFinding = {
  id: string; area_id: string; area_code: string; area_name: string; item_label: string; description: string; status: CustomerFindingStatus;
  raised_on: string; due_date: string | null; fixed_on: string | null; verified_on: string | null; evidence_photo_id: string; fix_photo_id: string | null;
};

const chip = (on: boolean) => cn("rounded-md border px-3 py-1.5 text-sm", on ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white hover:bg-steel-100");

/** What a customer sees of quality: a weekly score per rack and the findings with their photos and status. No person, no notes. */
export function CustomerQuality({ cells, findings, today }: { cells: QualityCell[]; findings: CustomerFinding[]; today: string }) {
  const weeks = useMemo(() => lastWeeks(today, 8), [today]);
  const racks = [...new Map(cells.map((c) => [c.area_id, c])).values()].sort((a, b) => a.area_code.localeCompare(b.area_code));
  const pct = (area: string, w: string) => cells.find((c) => c.area_id === area && c.week_start === w)?.pct ?? null;
  const [filter, setFilter] = useState<"todo" | "DONE">("todo");
  const [light, setLight] = useState<{ items: { id: string; caption: string }[]; index: number } | null>(null);
  const counts = countFindings(findings, today);
  const latestWeek = [...weeks].reverse().find((w) => cells.some((c) => c.week_start === w));
  const latestPcts = latestWeek ? racks.map((r) => pct(r.area_id, latestWeek)).filter((p): p is number => p !== null) : [];
  const avg = latestPcts.length ? Math.round(latestPcts.reduce((n, p) => n + p, 0) / latestPcts.length) : null;
  const shown = findings.filter((f) => (filter === "todo" ? f.status !== "DONE" : f.status === "DONE"));

  if (racks.length === 0 && findings.length === 0) return null;
  return (
    <section className="space-y-4" aria-labelledby="h-quality">
      <h2 id="h-quality" className="font-cond text-xl font-semibold">Kualitas mingguan</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={latestWeek ? `Skor minggu ${dateLabel(latestWeek).slice(0, 6)}` : "Skor terakhir"} value={pctLabel(avg)} hint={`${latestPcts.length} rak dinilai`} />
        <StatTile label="Temuan terbuka" value={counts.open + counts.fixed} hint="belum diverifikasi" tone={counts.open + counts.fixed ? "warn" : undefined} />
        <StatTile label="Lewat batas" value={counts.overdue} tone={counts.overdue ? "warn" : undefined} />
        <StatTile label="Selesai (90 hari)" value={counts.done} />
      </div>

      {racks.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-steel-100 bg-white">
          <Table>
            <thead><tr><Th>Rak / lokasi</Th>{weeks.map((w) => <Th key={w} className="text-center">{dateLabel(w).slice(0, 6)}</Th>)}<Th className="text-center">Tren</Th></tr></thead>
            <tbody>{racks.map((r) => {
              const series = weeks.map((w) => pct(r.area_id, w));
              return (
                <tr key={r.area_id}>
                  <Td><span className="font-cond text-lg font-bold">{r.area_code}</span><div className="text-xs text-steel-500">{r.area_name}</div></Td>
                  {series.map((p, i) => <Td key={weeks[i]} className="text-center">{p === null ? <span className="text-steel-300">–</span> : <Pill tone={scoreTone(p)}>{p}%</Pill>}</Td>)}
                  <Td className="text-center text-sm tabular">{trendLabel(trend(series))}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          <button type="button" className={chip(filter === "todo")} onClick={() => setFilter("todo")}>Terbuka · {counts.open + counts.fixed}</button>
          <button type="button" className={chip(filter === "DONE")} onClick={() => setFilter("DONE")}>Selesai · {counts.done}</button>
        </div>
        {shown.length === 0 && <p className="rounded-lg border border-dashed border-steel-300 bg-white p-5 text-center text-sm text-steel-500">{filter === "todo" ? "Tidak ada temuan terbuka." : "Belum ada temuan yang selesai."}</p>}
        {shown.map((f) => {
          const st = FINDING_STATE[f.status];
          const photos = [{ id: f.evidence_photo_id, caption: `${f.area_code} · temuan` }, ...(f.fix_photo_id ? [{ id: f.fix_photo_id, caption: `${f.area_code} · setelah diperbaiki` }] : [])];
          return (
            <div key={f.id} className="flex flex-wrap gap-3 rounded-lg border border-steel-100 bg-white p-3 text-sm">
              <div className="flex gap-2">
                {photos.map((p, i) => <HkThumb key={p.id} id={p.id} className="h-20 w-20" label={p.caption} onClick={() => setLight({ items: photos, index: i })} />)}
              </div>
              <div className="min-w-48 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-cond text-lg font-bold">{f.area_code}</span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {f.due_date && f.status === "OPEN" && <Pill tone={f.due_date < today ? "bad" : "neutral"}>Batas {dateLabel(f.due_date)}</Pill>}
                </div>
                <p><b>{f.item_label}</b>: {f.description}</p>
                <p className="text-xs text-steel-500">Ditemukan {dateLabel(f.raised_on)}{f.fixed_on ? ` · diperbaiki ${dateLabel(f.fixed_on)}` : ""}{f.verified_on ? ` · diverifikasi ${dateLabel(f.verified_on)}` : ""}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-steel-500">Skor = poin penilaian ÷ poin terbaik, satu per rak per minggu. Hijau 85% ke atas, kuning 70-84%, merah di bawahnya.</p>
      {light && <Lightbox items={light.items} index={light.index} onIndex={(i) => setLight((l) => (l ? { ...l, index: i } : l))} onClose={() => setLight(null)} />}
    </section>
  );
}
