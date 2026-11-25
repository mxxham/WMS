"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { callRpc } from "@/components/ckb/rpc-button";
import { Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { HK_PHOTO_LABEL, addDays, dateLabel, dayFull, type HkPhotoKind } from "@/lib/ckb/housekeeping";
import { RATINGS, RATING_LABEL, missingItems, scorePct, scoreTone, type Rating } from "@/lib/ckb/hk-quality";
import { cn } from "@/lib/utils";
import { Lightbox } from "./lightbox";
import { HkThumb } from "./photo-slot";

const TEXTAREA = "flex w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm placeholder:text-steel-500";
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={TEXTAREA} {...props} />; }

export type ChecklistItem = { id: string; label: string; sort: number; active: boolean };
export type ScoreTarget = { areaId: string; areaCode: string; areaName: string; week: string };
type DayPhotos = { id: string; work_date: string; late: boolean; ckb_hk_photos: { id: string; kind: HkPhotoKind; withdrawn_at: string | null }[] };

/**
 * Scoring one rack for one week, judged from its photos. Tap a rating for every active checklist item, save; the week's
 * score is a percentage. A photo that shows a problem becomes a finding in two taps. A re-score is a new version.
 */
export function ScoreDialog({ target, items, onClose }: { target: ScoreTarget | null; items: ChecklistItem[]; onClose: () => void }) {
  const router = useRouter();
  const active = items.filter((i) => i.active).sort((a, b) => a.sort - b.sort);
  const [days, setDays] = useState<DayPhotos[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, Rating | undefined>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [light, setLight] = useState<{ items: { id: string; caption: string }[]; index: number } | null>(null);
  const [draft, setDraft] = useState<{ photo: string; caption: string; item: string; description: string; due: string; busy: boolean; error: string | null } | null>(null);
  const [raised, setRaised] = useState(0);

  useEffect(() => {
    setDays(null); setError(null); setRated({}); setNote(""); setDone(null); setDraft(null); setRaised(0);
    if (!target) return;
    void (async () => {
      const { data, error: err } = await createClient().from("ckb_hk_checkins")
        .select("id, work_date, late, ckb_hk_photos(id, kind, withdrawn_at)")
        .eq("area_id", target.areaId).gte("work_date", target.week).lte("work_date", addDays(target.week, 4)).in("status", ["SUBMITTED", "ACCEPTED"]).order("work_date");
      if (err) { setError(err.message); return; }
      setDays(((data ?? []) as unknown as DayPhotos[]).map((d) => ({ ...d, ckb_hk_photos: d.ckb_hk_photos.filter((p) => !p.withdrawn_at).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "BEFORE" ? -1 : 1)) })));
    })();
  }, [target]);

  const missing = missingItems(active.map((i) => i.id), rated);
  const pct = missing.length === 0 ? scorePct(active.map((i) => rated[i.id] as Rating)) : null;
  const allPhotos = (days ?? []).flatMap((d) => d.ckb_hk_photos.map((p) => ({ id: p.id, caption: `${dayFull(d.work_date)} · Foto ${HK_PHOTO_LABEL[p.kind].toLowerCase()}` })));

  async function save() {
    if (!target || pct === null) return;
    setBusy(true); setError(null);
    const [res, err] = await callRpc<{ pct: number; version: number }>("ckb_hk_score_week", {
      p_area: target.areaId, p_week: target.week, p_ratings: active.map((i) => ({ item_id: i.id, rating: rated[i.id] })), p_note: note.trim() || null,
    });
    setBusy(false);
    if (err || !res) { setError(err ?? "Gagal menyimpan."); return; }
    setDone(`Tersimpan: ${res.pct}% (versi ${res.version}).`);
    router.refresh();
  }

  async function raise() {
    if (!target || !draft) return;
    setDraft({ ...draft, busy: true, error: null });
    const [, err] = await callRpc("ckb_hk_raise_finding", {
      p_area: target.areaId, p_item: draft.item.trim(), p_description: draft.description.trim(), p_photo: draft.photo, p_due: draft.due || null, p_score: null,
    });
    if (err) { setDraft({ ...draft, busy: false, error: err }); return; }
    setRaised((n) => n + 1); setDraft(null);
    router.refresh();
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      {target && (
        <DialogContent title={`Nilai ${target.areaCode} · minggu ${dateLabel(target.week)}`} description={target.areaName} className="sm:w-[44rem]">
          {error && <p role="alert" className="mb-3 rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}

          <section className="space-y-2">
            <h3 className="font-cond text-lg font-semibold">Foto minggu ini</h3>
            {!days && !error && <p className="text-sm text-steel-500">Memuat foto…</p>}
            {days && days.length === 0 && <p className="text-sm text-steel-500">Tidak ada check-in selesai pada minggu ini, jadi belum bisa dinilai.</p>}
            {days?.map((d) => (
              <div key={d.id} className="space-y-1">
                <p className="text-sm font-semibold">{dayFull(d.work_date)} {d.late && <Pill tone="warn">Terlambat</Pill>}</p>
                <div className="flex flex-wrap gap-2">
                  {d.ckb_hk_photos.map((p) => (
                    <div key={p.id} className="space-y-1 text-center">
                      <HkThumb id={p.id} label={`Foto ${HK_PHOTO_LABEL[p.kind].toLowerCase()}`} className="h-20 w-20"
                        onClick={() => setLight({ items: allPhotos, index: allPhotos.findIndex((x) => x.id === p.id) })} />
                      <button type="button" className="text-xs text-ckb underline" onClick={() => setDraft({ photo: p.id, caption: `${dayFull(d.work_date)} · ${HK_PHOTO_LABEL[p.kind].toLowerCase()}`, item: "", description: "", due: "", busy: false, error: null })}>Buat temuan</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {raised > 0 && <p className="text-sm text-ok">{raised} temuan dibuat. Lihat daftarnya di bawah tabel.</p>}
          </section>

          {draft && (
            <section className="mt-4 space-y-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
              <p className="font-semibold">Temuan dari foto {draft.caption}</p>
              <div><Label htmlFor="fd-item">Item yang bermasalah</Label>
                <Input id="fd-item" list="fd-items" value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} placeholder="mis. Palet rapi dan lurus" />
                <datalist id="fd-items">{active.map((i) => <option key={i.id} value={i.label} />)}</datalist></div>
              <div><Label htmlFor="fd-desc">Uraian</Label>
                <Textarea id="fd-desc" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="mis. Dua palet miring di sudut kiri" />
                <p className="mt-1 text-xs text-warn">Uraian ini terlihat oleh customer. Jangan menulis nama orang.</p></div>
              <div><Label htmlFor="fd-due">Batas perbaikan (boleh kosong)</Label><Input id="fd-due" type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} /></div>
              {draft.error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-bad">{draft.error}</p>}
              <div className="flex gap-2">
                <Button size="sm" disabled={draft.busy || draft.item.trim().length < 3 || draft.description.trim().length < 3} onClick={() => void raise()}>{draft.busy ? "Menyimpan…" : "Simpan temuan"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Batal</Button>
              </div>
            </section>
          )}

          <section className="mt-5 space-y-3">
            <h3 className="font-cond text-lg font-semibold">Penilaian</h3>
            <p className="text-xs text-steel-500">Nilai setiap item dari foto di atas. Rak yang Anda pegang sendiri tidak bisa Anda nilai.</p>
            {active.map((i) => (
              <div key={i.id} className="space-y-1">
                <p className="text-sm font-medium">{i.label}</p>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={i.label}>
                  {RATINGS.map((r) => (
                    <button key={r} type="button" aria-pressed={rated[i.id] === r} onClick={() => setRated((x) => ({ ...x, [i.id]: r }))}
                      className={cn("min-h-10 rounded-md border px-2 text-sm", rated[i.id] === r
                        ? r === "GOOD" ? "border-ok bg-ok text-white" : r === "FAIR" ? "border-warn bg-warn text-white" : "border-bad bg-bad text-white"
                        : "border-steel-300 bg-white hover:bg-steel-100")}>
                      {RATING_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div><Label htmlFor="sc-note">Catatan (opsional, hanya terlihat staf)</Label><Textarea id="sc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="sticky bottom-0 flex flex-wrap items-center gap-3 bg-white/95 py-2 backdrop-blur">
              <Button disabled={pct === null || busy || !!done} onClick={() => void save()}>{busy ? "Menyimpan…" : "Simpan penilaian"}</Button>
              {pct !== null && <Pill tone={scoreTone(pct)}>{pct}%</Pill>}
              {pct === null && <span className="text-xs text-steel-500">{missing.length} item belum dinilai</span>}
              {done && <span className="text-sm text-ok">{done}</span>}
            </div>
          </section>
          {light && <Lightbox items={light.items} index={light.index} onIndex={(i) => setLight((l) => (l ? { ...l, index: i } : l))} onClose={() => setLight(null)} />}
        </DialogContent>
      )}
    </Dialog>
  );
}
