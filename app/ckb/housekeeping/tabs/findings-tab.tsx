"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { callRpc } from "@/components/ckb/rpc-button";
import { Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { HK_PHOTO_LABEL, dateLabel, hkDateTime, type HkPhotoKind } from "@/lib/ckb/housekeeping";
import { FINDING_STATE, isOverdue } from "@/lib/ckb/hk-quality";
import { cn } from "@/lib/utils";
import { Lightbox } from "../lightbox";
import { HkThumb } from "../photo-slot";
import type { FindingRow } from "./quality-tab";

type Candidate = { id: string; kind: HkPhotoKind; uploaded_at: string };

/** What a PIC must fix on their racks: the photo it was found on, the description, the due date, and a way to say it is fixed. */
export function FindingsTab({ findings, today }: { findings: FindingRow[]; today: string }) {
  const [light, setLight] = useState<{ items: { id: string; caption: string }[]; index: number } | null>(null);
  const [fix, setFix] = useState<FindingRow | null>(null);
  const todo = findings.filter((f) => f.status === "OPEN" || f.status === "FIXED");
  const closed = findings.filter((f) => f.status === "VERIFIED");

  const card = (f: FindingRow) => {
    const st = FINDING_STATE[f.status];
    return (
      <div key={f.id} className={cn("space-y-2 rounded-lg border bg-white p-3 text-sm", isOverdue(f, today) ? "border-bad/40" : "border-steel-100")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-cond text-xl font-bold">{f.ckb_hk_areas?.code ?? "?"}</span>
          <Pill tone={st.tone}>{st.label}</Pill>
          {isOverdue(f, today) && <Pill tone="bad">Lewat batas</Pill>}
          {f.due_date && f.status === "OPEN" && !isOverdue(f, today) && <Pill tone="neutral">Batas {dateLabel(f.due_date)}</Pill>}
          {f.reopen_count > 0 && f.status === "OPEN" && <Pill tone="warn">Dikembalikan</Pill>}
        </div>
        <div className="flex gap-3">
          <HkThumb id={f.evidence_photo_id} className="h-24 w-24" label="Foto temuan" onClick={() => setLight({ items: [{ id: f.evidence_photo_id, caption: f.description }], index: 0 })} />
          <div className="min-w-0 space-y-1">
            <p><b>{f.item_label}</b></p>
            <p>{f.description}</p>
            {f.status === "OPEN" && f.reopen_note && <p className="text-xs text-bad">Dikembalikan: {f.reopen_note}</p>}
            {f.status === "FIXED" && <p className="text-xs text-steel-500">Menunggu verifikasi supervisor. Catatan Anda: {f.fix_note}</p>}
            {f.status === "VERIFIED" && <p className="text-xs text-ok">Sudah diverifikasi {f.verified_at ? hkDateTime(f.verified_at) : ""}.</p>}
          </div>
        </div>
        {f.status === "OPEN" && <Button size="sm" onClick={() => setFix(f)}>Tandai sudah diperbaiki</Button>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-cond text-xl font-semibold">Perlu diperbaiki · {todo.length}</h2>
        {todo.length === 0
          ? <p className="rounded-lg border border-dashed border-steel-300 bg-white p-6 text-center text-sm text-steel-500">Tidak ada temuan di rak Anda.</p>
          : <div className="space-y-2">{todo.map(card)}</div>}
      </section>
      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-cond text-xl font-semibold">Selesai</h2>
          <div className="space-y-2">{closed.slice(0, 20).map(card)}</div>
        </section>
      )}
      <FixDialog finding={fix} onClose={() => setFix(null)} />
      {light && <Lightbox items={light.items} index={light.index} onIndex={(i) => setLight((l) => (l ? { ...l, index: i } : l))} onClose={() => setLight(null)} />}
    </div>
  );
}

function FixDialog({ finding, onClose }: { finding: FindingRow | null; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = finding?.id, areaId = finding?.area_id, raisedAt = finding?.raised_at;

  useEffect(() => {
    setNote(""); setPhoto(null); setCands(null); setError(null);
    if (!id || !areaId || !raisedAt) return;
    let live = true;
    // A fix photo must be a photo of a done check-in of this rack, taken after the finding was made.
    void createClient().from("ckb_hk_photos").select("id, kind, uploaded_at, ckb_hk_checkins!inner(area_id, status)")
      .eq("ckb_hk_checkins.area_id", areaId).in("ckb_hk_checkins.status", ["SUBMITTED", "ACCEPTED"]).is("withdrawn_at", null).gt("uploaded_at", raisedAt)
      .order("uploaded_at", { ascending: false }).limit(8)
      .then(({ data }) => { if (live) setCands((data ?? []) as unknown as Candidate[]); });
    return () => { live = false; };
  }, [id, areaId, raisedAt]);

  async function save() {
    if (!finding) return;
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_hk_fix_finding", { p_finding: finding.id, p_note: note.trim(), p_photo: photo });
    setBusy(false);
    if (err) { setError(err); return; }
    onClose(); router.refresh();
  }

  return (
    <Dialog open={!!finding} onOpenChange={(o) => { if (!o) onClose(); }}>
      {finding && (
        <DialogContent title={`Perbaikan ${finding.ckb_hk_areas?.code ?? ""}`} description={finding.description}>
          <div className="space-y-3 text-sm">
            <div><Label htmlFor="fx-note">Apa yang Anda perbaiki</Label>
              <textarea id="fx-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Palet sudah diluruskan"
                className="flex w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm placeholder:text-steel-500" /></div>
            <div className="space-y-1">
              <p className="font-medium">Foto setelah diperbaiki (boleh kosong)</p>
              <p className="text-xs text-steel-500">Pilih dari foto rak ini yang diambil setelah temuan dibuat. Isi check-in hari ini lebih dulu bila perlu foto baru.</p>
              {cands === null ? <p className="text-xs text-steel-500">Memuat…</p> : cands.length === 0 ? <p className="text-xs text-steel-500">Belum ada foto baru.</p> : (
                <div className="flex flex-wrap gap-2">
                  {cands.map((c) => (
                    <button key={c.id} type="button" aria-pressed={photo === c.id} onClick={() => setPhoto(photo === c.id ? null : c.id)}
                      className={cn("rounded-md p-0.5", photo === c.id ? "ring-2 ring-ckb" : "ring-1 ring-steel-100")}>
                      <HkThumb id={c.id} className="h-16 w-16" label={`Foto ${HK_PHOTO_LABEL[c.kind].toLowerCase()}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-bad">{error}</p>}
            <div className="flex gap-2">
              <Button disabled={note.trim().length < 3 || busy} onClick={() => void save()}>{busy ? "Menyimpan…" : "Kirim untuk diverifikasi"}</Button>
              <Button variant="ghost" onClick={onClose}>Batal</Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
