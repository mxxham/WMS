"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RpcButton, callRpc } from "@/components/ckb/rpc-button";
import { Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { HK_PHOTO_LABEL, HK_STATUS_LABEL, dateLabel, dayFull, hkDateTime as fmtDateTime, type HkPhotoKind } from "@/lib/ckb/housekeeping";
import { Lightbox } from "./lightbox";
import { HkThumb, PhotoSlots } from "./photo-slot";

type Attempt = {
  id: string; attempt: number; status: string; pic_name: string; late: boolean; started_at: string; submitted_at: string | null;
  on_behalf_name: string | null; on_behalf_reason: string | null; reviewed_name: string | null; review_note: string | null;
  cancel_reason: string | null; excuse_reason: string | null; excused_name: string | null;
  ckb_hk_photos: { id: string; kind: HkPhotoKind; withdrawn_at: string | null }[];
};
export type DayTarget = { areaId: string; areaCode: string; areaName: string; day: string; isLead: boolean };

const TONE: Record<string, "ok" | "bad" | "warn" | "info" | "neutral"> = { ACCEPTED: "ok", SUBMITTED: "ok", REJECTED: "bad", CANCELLED: "neutral", EXCUSED: "neutral", STARTED: "info" };

/**
 * Everything about one rack on one day, in one dialog: every attempt with its photos, who did it and the review note
 * (staff only; customers never reach this component), and the actions that fit the state. Opened from the recap grid,
 * the review queue and the PIC's history.
 */
export function DayPanel({ target, onClose, maxPerKind = 3, maxEdge = 1600 }: { target: DayTarget | null; onClose: () => void; maxPerKind?: number; maxEdge?: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<Attempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [light, setLight] = useState<{ items: { id: string; caption: string }[]; index: number } | null>(null);
  const [behalf, setBehalf] = useState<{ open: boolean; reason: string; busy: boolean; error: string | null; checkin: string | null }>({ open: false, reason: "", busy: false, error: null, checkin: null });

  const load = useCallback(async () => {
    if (!target) return;
    const { data, error: err } = await createClient().from("ckb_hk_checkins")
      .select("id, attempt, status, pic_name, late, started_at, submitted_at, on_behalf_name, on_behalf_reason, reviewed_name, review_note, cancel_reason, excuse_reason, excused_name, ckb_hk_photos(id, kind, withdrawn_at)")
      .eq("area_id", target.areaId).eq("work_date", target.day).order("attempt", { ascending: false });
    if (err) { setError(err.message); return; }
    setError(null);
    setRows(((data ?? []) as unknown as Attempt[])
      .map((r) => ({ ...r, ckb_hk_photos: r.ckb_hk_photos.filter((p) => !p.withdrawn_at) })));
  }, [target]);
  useEffect(() => { setRows(null); setBehalf({ open: false, reason: "", busy: false, error: null, checkin: null }); void load(); }, [load]);

  const refresh = () => { void load(); router.refresh(); };
  const latest = rows?.[0];
  const canAct = !!target?.isLead;
  const startable = !latest || ["REJECTED", "CANCELLED"].includes(latest.status);
  const excusable = canAct && (!latest || ["REJECTED", "CANCELLED"].includes(latest.status));

  async function startBehalf() {
    if (!target) return;
    setBehalf((b) => ({ ...b, busy: true, error: null }));
    const [res, err] = await callRpc<{ id: string }>("ckb_hk_start", { p_area: target.areaId, p_date: target.day, p_reason: behalf.reason.trim() });
    if (err || !res) { setBehalf((b) => ({ ...b, busy: false, error: err ?? "Gagal." })); return; }
    setBehalf((b) => ({ ...b, busy: false, checkin: res.id }));
    refresh();
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      {target && (
        <DialogContent title={`${target.areaCode} · ${dayFull(target.day)}`} description={target.areaName} className="sm:w-[42rem]">
          {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">Tidak bisa dimuat: {error}</p>}
          {!rows && !error && <p className="text-sm text-steel-500">Memuat…</p>}
          {rows && rows.length === 0 && <p className="text-sm text-steel-500">Belum ada check-in pada hari ini.</p>}
          <div className="space-y-4">
            {rows?.map((r) => {
              const all = r.ckb_hk_photos.map((p) => ({ id: p.id, caption: `Percobaan ${r.attempt} · Foto ${HK_PHOTO_LABEL[p.kind].toLowerCase()}` }));
              return (
                <div key={r.id} className="space-y-2 rounded-lg border border-steel-100 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>Percobaan ke-{r.attempt}</b>
                    <Pill tone={TONE[r.status] ?? "neutral"}>{HK_STATUS_LABEL[r.status] ?? r.status}</Pill>
                    {r.late && <Pill tone="warn">Terlambat</Pill>}
                    {r.on_behalf_name && <Pill tone="neutral">Atas nama</Pill>}
                  </div>
                  <p className="text-xs text-steel-500">
                    PIC {r.pic_name}{r.status === "EXCUSED" ? "" : ` · mulai ${fmtDateTime(r.started_at)}`}{r.submitted_at ? ` · dikirim ${fmtDateTime(r.submitted_at)}` : ""}
                    {r.on_behalf_name ? ` · dicatat ${r.on_behalf_name}: ${r.on_behalf_reason}` : ""}
                    {r.reviewed_name ? ` · ditinjau ${r.reviewed_name}` : ""}
                  </p>
                  {r.review_note && <p className="text-xs text-bad">Catatan tinjauan: {r.review_note}</p>}
                  {r.cancel_reason && <p className="text-xs text-steel-500">Dibatalkan: {r.cancel_reason}</p>}
                  {r.excuse_reason && <p className="text-xs text-steel-500">Dibebaskan{r.excused_name ? ` oleh ${r.excused_name}` : ""}: {r.excuse_reason}</p>}
                  {r.status === "STARTED" && canAct && (
                    <div className="space-y-2">
                      <PhotoSlots checkinId={r.id} maxPerKind={maxPerKind} maxEdge={maxEdge} onChanged={refresh} />
                    </div>
                  )}
                  {r.status !== "STARTED" && (["BEFORE", "AFTER"] as HkPhotoKind[]).map((k) => {
                    const ph = r.ckb_hk_photos.filter((p) => p.kind === k);
                    return ph.length === 0 ? null : (
                      <div key={k} className="space-y-1">
                        <p className="font-semibold">{HK_PHOTO_LABEL[k]}</p>
                        <div className="flex flex-wrap gap-2">{ph.map((p) => <HkThumb key={p.id} id={p.id} label={`Foto ${HK_PHOTO_LABEL[k].toLowerCase()}`} onClick={() => setLight({ items: all, index: all.findIndex((x) => x.id === p.id) })} />)}</div>
                      </div>
                    );
                  })}
                  {canAct && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {r.status === "SUBMITTED" && (
                        <>
                          <RpcButton rpc="ckb_hk_review" args={{ p_checkin: r.id, p_accept: true, p_note: null }} title="Terima housekeeping" confirmLabel="Terima" size="sm" onDone={refresh}
                            summary={`Terima housekeeping ${target.areaCode} tanggal ${target.day}.`}>Terima</RpcButton>
                          <RpcButton rpc="ckb_hk_review" args={{ p_checkin: r.id, p_accept: false }} reason={{ arg: "p_note", label: "Alasan penolakan", required: true, placeholder: "mis. foto tidak menunjukkan rak" }}
                            title="Tolak housekeeping" confirmLabel="Tolak" size="sm" variant="outline" onDone={refresh}
                            summary={`Tolak housekeeping ${target.areaCode} tanggal ${target.day}. Hari itu kembali belum selesai dan PIC mengulang.`}>Tolak</RpcButton>
                        </>
                      )}
                      {r.status === "STARTED" && (
                        <RpcButton rpc="ckb_hk_abandon" args={{ p_checkin: r.id }} reason={{ arg: "p_reason", label: "Alasan pembatalan", required: true, placeholder: "mis. PIC pulang, tidak kembali" }}
                          title="Batalkan check-in" confirmLabel="Batalkan check-in" size="sm" variant="outline" onDone={refresh}
                          summary={`Check-in ${target.areaCode} tanggal ${target.day} yang belum dikirim dibatalkan. Hari itu bisa diisi lagi sebagai percobaan berikutnya.`}>Batalkan check-in</RpcButton>
                      )}
                      {r.status === "EXCUSED" && (
                        <RpcButton rpc="ckb_hk_revoke_excuse" args={{ p_checkin: r.id }} reason={{ arg: "p_reason", label: "Alasan", required: true }}
                          title="Batalkan pembebasan" confirmLabel="Batalkan pembebasan" size="sm" variant="outline" onDone={refresh}
                          summary={`Hari ${target.day} untuk ${target.areaCode} kembali dihitung. Bila tidak diisi, hari itu terlewat.`}>Batalkan pembebasan</RpcButton>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {canAct && rows && (startable || excusable) && (
            <div className="space-y-3 rounded-lg border border-dashed border-steel-300 p-3 text-sm">
              <p className="font-semibold">Hari ini belum selesai</p>
              {!behalf.open && (
                <div className="flex flex-wrap gap-2">
                  {startable && <Button size="sm" onClick={() => setBehalf((b) => ({ ...b, open: true }))}>Catat atas nama PIC</Button>}
                  {excusable && (
                    <RpcButton rpc="ckb_hk_excuse" args={{ p_area: target.areaId, p_day: target.day }} reason={{ arg: "p_reason", label: "Alasan pembebasan", required: true, placeholder: "mis. PIC sakit, rak kosong" }}
                      title="Bebaskan hari" confirmLabel="Bebaskan" size="sm" variant="outline" onDone={refresh}
                      summary={`Hari ${target.day} untuk ${target.areaCode} tidak dihitung terlewat. Customer melihatnya sebagai tidak dijadwalkan, tanpa alasan.`}>Bebaskan hari</RpcButton>
                  )}
                </div>
              )}
              {behalf.open && !behalf.checkin && (
                <div className="space-y-2">
                  <p className="text-xs text-steel-500">Foto sebelum dan sesudah tetap wajib. Tercatat sebagai atas nama; customer hanya melihat tandanya, bukan nama Anda.</p>
                  <Label htmlFor="dp-reason">Alasan (wajib)</Label>
                  <Input id="dp-reason" value={behalf.reason} onChange={(e) => setBehalf((b) => ({ ...b, reason: e.target.value }))} placeholder="mis. PIC sakit, tidak ada telepon" />
                  {behalf.error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-bad">{behalf.error}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" disabled={behalf.reason.trim().length < 3 || behalf.busy} onClick={() => void startBehalf()}>{behalf.busy ? "Membuka…" : "Mulai"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setBehalf((b) => ({ ...b, open: false }))}>Batal</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {light && <Lightbox items={light.items} index={light.index} onIndex={(i) => setLight((l) => (l ? { ...l, index: i } : l))} onClose={() => setLight(null)} />}
        </DialogContent>
      )}
    </Dialog>
  );
}
