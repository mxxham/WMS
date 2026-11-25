"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RpcButton, callRpc } from "@/components/ckb/rpc-button";
import { Pill, StatTile } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { addDays, dateLabel, hkDateTime, pctLabel, type GridRow } from "@/lib/ckb/housekeeping";
import { FINDING_STATE, canVerify, countFindings, isOverdue, lastWeeks, latestScores, scoreTone, trend, trendLabel, type FindingStatus } from "@/lib/ckb/hk-quality";
import { cn } from "@/lib/utils";
import { Lightbox } from "../lightbox";
import { HkThumb } from "../photo-slot";
import { ScoreDialog, type ChecklistItem, type ScoreTarget } from "../score-dialog";

export type ScoreItem = { area_id: string; week_start: string; version: number; pct: number; scored_name: string };
export type FindingRow = {
  id: string; area_id: string; item_label: string; description: string; evidence_photo_id: string; due_date: string | null; status: FindingStatus;
  raised_by: string; raised_name: string; raised_at: string; fixed_by: string | null; fixed_name: string | null; fixed_at: string | null; fix_note: string | null;
  fix_photo_id: string | null; verified_name: string | null; verified_at: string | null; verify_note: string | null; reopen_count: number; reopen_note: string | null;
  cancel_reason: string | null; ckb_hk_areas: { code: string; name: string } | null;
};

const chip = (on: boolean) => cn("rounded-md border px-3 py-1.5 text-sm", on ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white hover:bg-steel-100");

/** Weekly quality, for supervisors and admins: a score per rack and week, the findings still to close, and (admin) the checklist. */
export function QualityTab({ week, today, userId, isAdmin, rows, scores, items, findings, customers, customerId }: {
  week: string; today: string; userId: string; isAdmin: boolean; rows: GridRow[]; scores: ScoreItem[]; items: ChecklistItem[]; findings: FindingRow[];
  customers: { id: string; name: string }[]; customerId: string | null;
}) {
  const [target, setTarget] = useState<ScoreTarget | null>(null);
  const href = (w: string, c: string | null = customerId) => `/ckb/housekeeping?tab=quality&week=${w}${c ? `&c=${c}` : ""}`;
  const weeks = useMemo(() => lastWeeks(today, 8), [today]);
  const latest = useMemo(() => latestScores(scores), [scores]);
  const pctOf = (area: string, w: string) => latest.find((s) => s.area_id === area && s.week_start === w);

  const everyArea = [...new Map(rows.map((r) => [r.area_id, r])).values()].sort((a, b) => a.area_code.localeCompare(b.area_code));
  const scheduled = new Set(rows.filter((r) => r.state !== "NA").map((r) => r.area_id));
  const areas = everyArea.filter((a) => scheduled.has(a.area_id));
  const doneDays = (area: string) => new Set(rows.filter((r) => r.area_id === area && r.state === "DONE").map((r) => r.day)).size;
  const picOf = (area: string) => rows.find((r) => r.area_id === area && r.pic_name)?.pic_name ?? null;

  const thisWeek = areas.map((a) => pctOf(a.area_id, week)?.pct).filter((p): p is number => p !== undefined);
  const avg = thisWeek.length ? Math.round(thisWeek.reduce((n, p) => n + p, 0) / thisWeek.length) : null;
  const unscored = areas.filter((a) => doneDays(a.area_id) > 0 && !pctOf(a.area_id, week)).length;
  const counts = countFindings(findings, today);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Skor rata-rata minggu ini" value={pctLabel(avg)} hint={`${thisWeek.length} rak dinilai`} />
        <StatTile label="Belum dinilai" value={unscored} hint="rak dengan foto, tanpa skor" tone={unscored ? "warn" : undefined} />
        <StatTile label="Temuan terbuka" value={counts.open} hint={counts.overdue ? `${counts.overdue} lewat batas` : "belum diperbaiki"} tone={counts.open ? "warn" : undefined} />
        <StatTile label="Menunggu verifikasi" value={counts.fixed} hint="sudah diperbaiki PIC" tone={counts.fixed ? "warn" : undefined} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link href={href(addDays(week, -7))} aria-label="Minggu sebelumnya"><ChevronLeft className="h-4 w-4" /></Link></Button>
          <p className="font-cond text-lg font-semibold">{dateLabel(week)} – {dateLabel(addDays(week, 4))}</p>
          <Button asChild variant="outline" size="sm"><Link href={href(addDays(week, 7))} aria-label="Minggu berikutnya"><ChevronRight className="h-4 w-4" /></Link></Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Link href={href(week, null)} className={chip(!customerId)}>Semua customer</Link>
          {customers.map((c) => <Link key={c.id} href={href(week, c.id)} className={chip(c.id === customerId)}>{c.name}</Link>)}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="font-cond text-xl font-semibold">Skor mingguan per rak</h2>
        {areas.length === 0 ? <p className="text-sm text-steel-500">Belum ada rak yang dijadwalkan pada minggu ini.</p> : (
          <div className="overflow-x-auto rounded-lg border border-steel-100 bg-white">
            <Table>
              <thead><tr>
                <Th className="sticky left-0 bg-white">Rak</Th><Th>PIC</Th><Th className="text-center">Hari selesai</Th>
                {weeks.map((w) => <Th key={w} className={cn("text-center", w === week && "bg-ckb-tint/40")}>{dateLabel(w).slice(0, 6)}</Th>)}
                <Th className="text-center">Tren</Th><Th />
              </tr></thead>
              <tbody>{areas.map((a) => {
                const series = weeks.map((w) => pctOf(a.area_id, w)?.pct ?? null);
                const cur = pctOf(a.area_id, week);
                const n = doneDays(a.area_id);
                return (
                  <tr key={a.area_id}>
                    <Td className="sticky left-0 bg-white"><span className="font-cond text-lg font-bold">{a.area_code}</span> <span className="text-xs text-steel-500">{a.customer_code}</span><div className="text-xs text-steel-500">{a.area_name}</div></Td>
                    <Td className="text-sm">{picOf(a.area_id) ?? <span className="text-warn">belum ada PIC</span>}</Td>
                    <Td className="text-center tabular">{n}/5</Td>
                    {weeks.map((w, i) => (
                      <Td key={w} className={cn("text-center", w === week && "bg-ckb-tint/40")}>
                        {series[i] === null ? <span className="text-steel-300">–</span> : <Pill tone={scoreTone(series[i])}>{series[i]}%</Pill>}
                      </Td>
                    ))}
                    <Td className="text-center text-sm tabular">{trendLabel(trend(series))}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant={cur ? "outline" : "default"} disabled={n === 0} title={n === 0 ? "Belum ada foto yang selesai minggu ini" : undefined}
                        onClick={() => setTarget({ areaId: a.area_id, areaCode: a.area_code, areaName: a.area_name, week })}>{cur ? `Nilai ulang (v${cur.version})` : "Nilai"}</Button>
                    </Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          </div>
        )}
        <p className="text-xs text-steel-500">Skor = poin ÷ poin terbaik (Baik 2, Perlu perbaikan 1, Buruk 0). Nilai ulang membuat versi baru; versi lama tetap tersimpan. Hijau 85% ke atas, kuning 70-84%, merah di bawahnya.</p>
      </section>

      <Findings findings={findings} userId={userId} today={today} />
      {isAdmin && <Checklist items={items} />}
      <ScoreDialog target={target} items={items} onClose={() => setTarget(null)} />
    </div>
  );
}

function Findings({ findings, userId, today }: { findings: FindingRow[]; userId: string; today: string }) {
  const [filter, setFilter] = useState<"todo" | "FIXED" | "VERIFIED" | "CANCELLED">("todo");
  const [light, setLight] = useState<{ items: { id: string; caption: string }[]; index: number } | null>(null);
  const shown = findings.filter((f) => (filter === "todo" ? f.status === "OPEN" || f.status === "FIXED" : f.status === filter));
  const counts = countFindings(findings, today);
  const open = (f: FindingRow) => {
    const items = [{ id: f.evidence_photo_id, caption: `${f.ckb_hk_areas?.code ?? ""} · ${f.description}` }, ...(f.fix_photo_id ? [{ id: f.fix_photo_id, caption: `Setelah diperbaiki · ${f.ckb_hk_areas?.code ?? ""}` }] : [])];
    return items;
  };
  return (
    <section className="space-y-3">
      <h2 className="font-cond text-xl font-semibold">Temuan</h2>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={chip(filter === "todo")} onClick={() => setFilter("todo")}>Perlu tindakan · {counts.open + counts.fixed}</button>
        <button type="button" className={chip(filter === "FIXED")} onClick={() => setFilter("FIXED")}>Menunggu verifikasi · {counts.fixed}</button>
        <button type="button" className={chip(filter === "VERIFIED")} onClick={() => setFilter("VERIFIED")}>Selesai · {counts.done}</button>
        <button type="button" className={chip(filter === "CANCELLED")} onClick={() => setFilter("CANCELLED")}>Dibatalkan</button>
      </div>
      {shown.length === 0 && <p className="rounded-lg border border-dashed border-steel-300 bg-white p-5 text-center text-sm text-steel-500">Tidak ada temuan di sini. Buat temuan dari foto di jendela Nilai.</p>}
      <div className="space-y-2">
        {shown.map((f) => {
          const st = FINDING_STATE[f.status];
          return (
            <div key={f.id} className="flex flex-wrap gap-3 rounded-lg border border-steel-100 bg-white p-3 text-sm">
              <HkThumb id={f.evidence_photo_id} className="h-20 w-20" label="Foto temuan" onClick={() => setLight({ items: open(f), index: 0 })} />
              {f.fix_photo_id && <HkThumb id={f.fix_photo_id} className="h-20 w-20" label="Foto perbaikan" onClick={() => setLight({ items: open(f), index: 1 })} />}
              <div className="min-w-48 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-cond text-lg font-bold">{f.ckb_hk_areas?.code ?? "?"}</span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {isOverdue(f, today) && <Pill tone="bad">Lewat batas {dateLabel(f.due_date!)}</Pill>}
                  {f.due_date && !isOverdue(f, today) && f.status === "OPEN" && <Pill tone="neutral">Batas {dateLabel(f.due_date)}</Pill>}
                  {f.reopen_count > 0 && <Pill tone="warn">Dikembalikan {f.reopen_count}×</Pill>}
                </div>
                <p><b>{f.item_label}</b>: {f.description}</p>
                <p className="text-xs text-steel-500">Dibuat {f.raised_name} · {hkDateTime(f.raised_at)}</p>
                {f.reopen_note && f.status === "OPEN" && <p className="text-xs text-bad">Dikembalikan: {f.reopen_note}</p>}
                {f.fix_note && <p className="text-xs">Perbaikan ({f.fixed_name}, {hkDateTime(f.fixed_at)}): {f.fix_note}</p>}
                {f.verified_name && <p className="text-xs text-ok">Diverifikasi {f.verified_name}{f.verify_note ? `: ${f.verify_note}` : ""}</p>}
                {f.cancel_reason && <p className="text-xs text-steel-500">Dibatalkan: {f.cancel_reason}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {f.status === "FIXED" && canVerify(f, userId) && (
                    <>
                      <RpcButton rpc="ckb_hk_verify_finding" args={{ p_finding: f.id, p_ok: true, p_note: null }} title="Verifikasi perbaikan" confirmLabel="Verifikasi" size="sm"
                        summary={`Perbaikan ${f.item_label} di ${f.ckb_hk_areas?.code ?? "rak"} dinyatakan beres. Customer melihatnya sebagai selesai.`}>Verifikasi</RpcButton>
                      <RpcButton rpc="ckb_hk_verify_finding" args={{ p_finding: f.id, p_ok: false }} reason={{ arg: "p_note", label: "Alasan mengembalikan", required: true, placeholder: "mis. masih ada satu palet miring" }}
                        title="Kembalikan ke PIC" confirmLabel="Kembalikan" size="sm" variant="outline"
                        summary="Temuan kembali terbuka dan PIC memperbaikinya lagi.">Kembalikan</RpcButton>
                    </>
                  )}
                  {f.status === "FIXED" && !canVerify(f, userId) && <span className="text-xs text-steel-500">Diverifikasi oleh supervisor atau admin lain, bukan yang membuat atau memperbaikinya.</span>}
                  {(f.status === "OPEN" || f.status === "FIXED") && (
                    <RpcButton rpc="ckb_hk_cancel_finding" args={{ p_finding: f.id }} reason={{ arg: "p_reason", label: "Alasan pembatalan", required: true, placeholder: "mis. salah rak" }}
                      title="Batalkan temuan" confirmLabel="Batalkan temuan" size="sm" variant="ghost"
                      summary="Temuan dibatalkan dan tidak lagi terlihat oleh customer.">Batalkan</RpcButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {light && <Lightbox items={light.items} index={light.index} onIndex={(i) => setLight((l) => (l ? { ...l, index: i } : l))} onClose={() => setLight(null)} />}
    </section>
  );
}

/** The one shared checklist. A retired item stays on old scores; renaming is done by retiring and adding. */
function Checklist({ items }: { items: ChecklistItem[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...items].sort((a, b) => a.sort - b.sort);
  async function add() {
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_hk_checklist_save", { p_id: null, p_label: label.trim(), p_active: true, p_sort: null });
    setBusy(false);
    if (err) { setError(err); return; }
    setLabel(""); router.refresh();
  }
  return (
    <section className="space-y-3">
      <h2 className="font-cond text-xl font-semibold">Checklist penilaian</h2>
      <p className="text-sm text-steel-500">Satu daftar untuk semua rak. Item yang dinonaktifkan tidak muncul lagi pada penilaian baru, tetapi tetap ada pada skor lama dengan kata-katanya saat itu.</p>
      <ul className="divide-y divide-steel-100 rounded-lg border border-steel-100 bg-white">
        {sorted.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className={cn(!i.active && "text-steel-400 line-through")}>{i.label}</span>
            <RpcButton rpc="ckb_hk_checklist_save" args={{ p_id: i.id, p_label: i.label, p_active: !i.active }} title={i.active ? "Nonaktifkan item" : "Aktifkan item"} confirmLabel={i.active ? "Nonaktifkan" : "Aktifkan"} size="sm" variant="outline"
              summary={i.active ? `"${i.label}" tidak dipakai pada penilaian berikutnya.` : `"${i.label}" dipakai lagi pada penilaian berikutnya.`}>{i.active ? "Nonaktifkan" : "Aktifkan"}</RpcButton>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1"><Label htmlFor="cl-new">Item baru</Label><Input id="cl-new" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. Alat kebersihan disimpan rapi" maxLength={80} /></div>
        <Button disabled={label.trim().length < 3 || busy} onClick={() => void add()}>{busy ? "Menyimpan…" : "Tambah item"}</Button>
      </div>
      {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
    </section>
  );
}
