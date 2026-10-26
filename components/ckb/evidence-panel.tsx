"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { RpcButton } from "./rpc-button";
import { EVIDENCE_KINDS, EVIDENCE_KIND_LABEL, type EvidenceEntity, type EvidenceKind } from "@/lib/ckb/evidence";
import { fmtDateTime } from "@/lib/utils";

export type EvidenceRow = {
  id: string; kind: EvidenceKind; mime: string; size_bytes: number; description: string | null;
  uploaded_by: string; uploaded_by_name: string; uploaded_at: string; legal_hold: boolean;
};

/**
 * Evidence for one record. Files open through /api/ckb/evidence/[id], which checks access and logs
 * the view — so nothing is fetched automatically, only when someone taps Buka.
 */
export function EvidencePanel({ entityType, entityId, rows, canUpload, me, lead, defaultKind = "GENERAL" }: {
  entityType: EvidenceEntity; entityId: string; rows: EvidenceRow[]; canUpload: boolean; me?: string; lead?: boolean; defaultKind?: EvidenceKind;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<EvidenceKind>(defaultKind);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(null);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set("entity_type", entityType); fd.set("entity_id", entityId); fd.set("kind", kind); fd.set("description", desc); fd.set("file", f);
      const res = await fetch("/api/ckb/evidence", { method: "POST", body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(`${f.name}: ${b.error ?? "gagal diunggah"}`); break; }
    }
    setBusy(false); setDesc("");
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-sm text-steel-500">Belum ada bukti.</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-md border border-steel-100 bg-white p-3">
              {r.mime === "application/pdf" ? <FileText className="mt-0.5 h-5 w-5 shrink-0 text-steel-500" /> : <ImageIcon className="mt-0.5 h-5 w-5 shrink-0 text-steel-500" />}
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{EVIDENCE_KIND_LABEL[r.kind]}{r.legal_hold && <span className="ml-2 text-xs text-warn">ditahan</span>}</p>
                {r.description && <p className="truncate text-steel-700">{r.description}</p>}
                <p className="text-xs text-steel-500">{r.uploaded_by_name} · {fmtDateTime(r.uploaded_at)} · {Math.ceil(r.size_bytes / 1024)} KB</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <a href={`/api/ckb/evidence/${r.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-ckb hover:underline"><ExternalLink className="h-3.5 w-3.5" />Buka</a>
                  {canUpload && (r.uploaded_by === me || lead) && !r.legal_hold && (
                    <RpcButton rpc="ckb_withdraw_evidence" args={{ p_id: r.id }} size="sm" variant="ghost" title="Tarik bukti"
                      summary="Bukti ini disembunyikan dari daftar. File tetap disimpan dan penarikannya tercatat di log." reason={{ arg: "p_reason", label: "Alasan", required: true }}>
                      Tarik
                    </RpcButton>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="grid gap-2 rounded-md bg-paper p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <div><Label htmlFor={`ev-kind-${entityId}`} className="text-xs">Jenis</Label>
            <Select id={`ev-kind-${entityId}`} value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}>
              {EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{EVIDENCE_KIND_LABEL[k]}</option>)}
            </Select>
          </div>
          <div><Label htmlFor={`ev-desc-${entityId}`} className="text-xs">Keterangan (opsional)</Label><Input id={`ev-desc-${entityId}`} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="sr-only" id={`ev-file-${entityId}`}
              onChange={(e) => upload(e.target.files)} />
            <Button asChild disabled={busy}><label htmlFor={`ev-file-${entityId}`} className="cursor-pointer"><Camera className="h-4 w-4" />{busy ? "Mengunggah…" : "Foto / file"}</label></Button>
          </div>
          {error && <p role="alert" className="text-sm text-bad sm:col-span-3">{error}</p>}
        </div>
      )}
    </div>
  );
}
