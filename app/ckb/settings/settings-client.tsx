"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Notice } from "@/components/ckb/ui";
import { callRpc } from "@/components/ckb/rpc-button";
import { SAP_FIELDS, SAP_FIELD_LABEL, REQUIRED_FIELDS, type SapField } from "@/lib/ckb/sap-import";

type SapImport = { verified: boolean; columns: Partial<Record<SapField, string[]>> };
type Evidence = { max_mb: number; allowed_mime: string[]; retention_days: number };

/** One card per setting key; Simpan sends the whole value of that key. */
function Section({ title, settingKey, build, children, note }: {
  title: string; settingKey: string; build: (fd: FormData) => unknown; children: React.ReactNode; note?: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  async function save(fd: FormData) {
    setBusy(true); setMsg({});
    let value: unknown;
    try { value = build(fd); } catch (e) { setBusy(false); setMsg({ error: (e as Error).message }); return; }
    const [, err] = await callRpc("ckb_save_setting", { p_key: settingKey, p_value: value });
    setBusy(false);
    if (err) setMsg({ error: err }); else { setMsg({ ok: "Tersimpan." }); router.refresh(); }
  }
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <form action={save} className="space-y-3">
          {note}
          {children}
          {msg.error && <p role="alert" className="text-sm text-bad">{msg.error}</p>}
          {msg.ok && <p role="status" className="text-sm text-ok">{msg.ok}</p>}
          <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export function SettingsClient({ value }: { value: Record<string, unknown> }) {
  const warehouses = (value.warehouses as string[] | undefined) ?? [];
  const stocktake = (value.stocktake as { blind_default: boolean } | undefined) ?? { blind_default: true };
  const evidence = (value.evidence as Evidence | undefined) ?? { max_mb: 10, allowed_mime: [], retention_days: 730 };
  const inspection = (value.inspection as { require_photo_on_ng: boolean } | undefined) ?? { require_photo_on_ng: true };
  const sapImport = (value.sap_import as SapImport | undefined) ?? { verified: false, columns: {} };
  const sapExport = (value.sap_export as { verified: boolean; format_version: string } | undefined) ?? { verified: false, format_version: "CKB-INTERNAL-1" };

  return (
    <div className="space-y-4">
      <Section title="Gudang" settingKey="warehouses" build={(fd) => list(String(fd.get("w")))}>
        <Label htmlFor="s-w">Nama gudang (pisahkan dengan koma)</Label>
        <Input id="s-w" name="w" defaultValue={warehouses.join(", ")} />
      </Section>

      <Section title="Stock take" settingKey="stocktake" build={(fd) => ({ blind_default: fd.get("blind") === "on" })}>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="blind" defaultChecked={stocktake.blind_default} className="h-4 w-4" />
          Hitung buta sebagai bawaan (operator tidak melihat qty SAP saat menghitung)</label>
      </Section>

      <Section title="Bukti foto dan dokumen" settingKey="evidence"
        note={<p className="text-sm text-steel-500">Retensi minimal 365 hari. Bukti tidak pernah dihapus permanen; setelah masa simpan, admin mencatat pemindahan ke arsip.</p>}
        build={(fd) => ({ max_mb: Number(fd.get("mb")), retention_days: Number(fd.get("days")), allowed_mime: list(String(fd.get("mime"))) })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="s-mb">Ukuran maks (MB)</Label><Input id="s-mb" name="mb" type="number" min={1} max={50} defaultValue={evidence.max_mb} /></div>
          <div><Label htmlFor="s-days">Masa simpan (hari)</Label><Input id="s-days" name="days" type="number" min={365} defaultValue={evidence.retention_days} /></div>
          <div><Label htmlFor="s-mime">Tipe file</Label><Input id="s-mime" name="mime" defaultValue={evidence.allowed_mime.join(", ")} /></div>
        </div>
      </Section>

      <Section title="Inspeksi" settingKey="inspection" build={(fd) => ({ require_photo_on_ng: fd.get("photo") === "on" })}>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="photo" defaultChecked={inspection.require_photo_on_ng} className="h-4 w-4" />
          Butir NG wajib disertai minimal satu foto</label>
      </Section>

      <Section title="Pemetaan kolom import SAP" settingKey="sap_import"
        note={<Notice tone={sapImport.verified ? "info" : "warn"} title={sapImport.verified ? "Pemetaan sudah diverifikasi" : "Pemetaan belum diverifikasi"}>
          Judul kolom ini belum dicocokkan dengan file SAP CKB yang asli. Centang &quot;terverifikasi&quot; hanya setelah file SAP nyata
          dari customer berhasil dibaca dan angkanya dicocokkan. Setiap snapshot mencatat status ini.
        </Notice>}
        build={(fd) => {
          const columns: Partial<Record<SapField, string[]>> = {};
          for (const f of SAP_FIELDS) { const v = list(String(fd.get(`col-${f}`)).toLowerCase()); if (v.length) columns[f] = v; }
          for (const f of REQUIRED_FIELDS) if (!columns[f]) throw new Error(`Kolom wajib ${SAP_FIELD_LABEL[f]} belum dipetakan.`);
          return { verified: fd.get("verified") === "on", columns };
        }}>
        <div className="grid gap-3 sm:grid-cols-2">
          {SAP_FIELDS.map((f) => (
            <div key={f}>
              <Label htmlFor={`s-col-${f}`}>{SAP_FIELD_LABEL[f]}{REQUIRED_FIELDS.includes(f) ? " *" : ""}</Label>
              <Input id={`s-col-${f}`} name={`col-${f}`} defaultValue={(sapImport.columns[f] ?? []).join(", ")} placeholder="judul kolom, pisahkan koma" />
            </div>
          ))}
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="verified" defaultChecked={sapImport.verified} className="h-4 w-4" />
          Terverifikasi dengan file SAP CKB asli</label>
      </Section>

      <Section title="Format ekspor SAP" settingKey="sap_export"
        note={<Notice tone="warn">Belum ada spesifikasi unggah SAP dari CKB. File ekspor saat ini adalah lembar kerja internal ({sapExport.format_version}) dan bukan bukti posting.</Notice>}
        build={(fd) => ({ verified: fd.get("verified") === "on", format_version: String(fd.get("fv")).trim() })}>
        <div><Label htmlFor="s-fv">Versi format</Label><Input id="s-fv" name="fv" defaultValue={sapExport.format_version} /></div>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="verified" defaultChecked={sapExport.verified} className="h-4 w-4" />
          Format sudah disetujui sebagai format unggah SAP</label>
      </Section>
    </div>
  );
}
