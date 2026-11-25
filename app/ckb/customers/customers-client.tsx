"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Th, Td } from "@/components/ui/table";
import { Pill, EmptyState } from "@/components/ckb/ui";
import { callRpc } from "@/components/ckb/rpc-button";
import { MappingFields, readMapping } from "@/components/ckb/sap-mapping-fields";
import type { SapMapping } from "@/lib/ckb/sap-import";

export type CustomerRow = {
  id: string; code: string; name: string; active: boolean; notes: string | null; sap_customer_code: string | null;
  sap_plant: string | null; sap_storage_location: string | null; snapshot: string | null; reps: string[]; updated_at: string;
  /** 0133: a photo is required on every stock-take count of this customer */
  count_photo_required?: boolean;
  /** 0161: how this customer counts (FULL / MATERIAL_BIN), where the photo goes (TASK / BIN) and its own SAP column mapping (null = the global one) */
  count_identity?: "FULL" | "MATERIAL_BIN"; photo_scope?: "TASK" | "BIN";
  sap_mapping?: { verified: boolean; columns: SapMapping } | null;
};

export function CustomersClient({ rows, canEdit }: { rows: CustomerRow[]; canEdit: boolean }) {
  if (rows.length === 0) return <EmptyState title="Belum ada customer" action={canEdit && <CustomerDialog />} />;
  return (
    <div className="space-y-4">
      {canEdit && <CustomerDialog />}
      {/* Phone: cards. Desktop: table. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((c) => (
          <li key={c.id} className="rounded-lg border border-steel-100 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-cond text-lg font-semibold">{c.name}</p><p className="text-xs text-steel-500">{c.code}</p></div>
              <Pill tone={c.active ? "ok" : "muted"}>{c.active ? "Aktif" : "Nonaktif"}</Pill>
            </div>
            <p className="mt-2 text-sm text-steel-500">Snapshot aktif: {c.snapshot ?? "belum ada"}</p>
            <p className="text-sm text-steel-500">Perwakilan: {c.reps.join(", ") || "–"}</p>
            <p className="mt-1 text-sm text-steel-500">{profileText(c)}</p>
            {canEdit && <div className="mt-3 flex flex-wrap gap-2"><CustomerDialog row={c} /><CountProfileDialog row={c} /></div>}
          </li>
        ))}
      </ul>
      <div className="hidden rounded-lg border border-steel-100 bg-white md:block">
        <Table>
          <thead><tr><Th>Kode</Th><Th>Nama</Th><Th>Status</Th><Th>Kode SAP / plant / SLoc</Th><Th>Snapshot aktif</Th><Th>Perwakilan</Th><Th>Foto wajib di setiap hitungan</Th><Th>Profil hitung</Th>{canEdit && <Th />}</tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <Td className="font-cond font-semibold">{c.code}</Td>
                <Td>{c.name}{c.notes && <span className="block text-xs text-steel-500">{c.notes}</span>}</Td>
                <Td><Pill tone={c.active ? "ok" : "muted"}>{c.active ? "Aktif" : "Nonaktif"}</Pill></Td>
                <Td>{[c.sap_customer_code, c.sap_plant, c.sap_storage_location].map((v) => v ?? "–").join(" / ")}</Td>
                <Td>{c.snapshot ?? <span className="text-steel-500">belum ada</span>}</Td>
                <Td>{c.reps.join(", ") || "–"}</Td>
                <Td><CountPhotoSwitch id={c.id} name={c.name} on={!!c.count_photo_required} canEdit={canEdit} /></Td>
                <Td className="text-sm">{profileText(c)}</Td>
                {canEdit && <Td className="text-right"><div className="flex justify-end gap-2"><CustomerDialog row={c} /><CountProfileDialog row={c} /></div></Td>}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

function CustomerDialog({ row }: { row?: CustomerRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(fd: FormData) {
    setBusy(true); setError(null);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const [, err] = await callRpc("ckb_save_customer", {
      p_id: row?.id ?? null, p_code: row ? "" : s("code"), p_name: s("name"), p_active: fd.get("active") === "on",
      p_notes: s("notes"), p_sap_customer_code: s("sap_customer_code"), p_sap_plant: s("sap_plant"), p_sap_storage_location: s("sap_storage_location"),
    });
    setBusy(false);
    if (err) { setError(err); return; }
    setOpen(false); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>
        {row ? <Button variant="outline" size="sm">Ubah</Button> : <Button><Plus className="h-4 w-4" />Customer baru</Button>}
      </DialogTrigger>
      <DialogContent title={row ? `Ubah ${row.name}` : "Customer baru"} description={row ? "Kode customer tetap; perubahan lain dicatat di log aktivitas." : undefined}>
        <form action={save} className="space-y-3">
          {!row && (
            <div><Label htmlFor="c-code">Kode (huruf besar, 2-20)</Label><Input id="c-code" name="code" required pattern="[A-Za-z0-9_-]{2,20}" placeholder="FREEPORT" /></div>
          )}
          <div><Label htmlFor="c-name">Nama</Label><Input id="c-name" name="name" required minLength={2} defaultValue={row?.name} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="c-sap">Kode SAP</Label><Input id="c-sap" name="sap_customer_code" defaultValue={row?.sap_customer_code ?? ""} /></div>
            <div><Label htmlFor="c-plant">Plant</Label><Input id="c-plant" name="sap_plant" defaultValue={row?.sap_plant ?? ""} /></div>
            <div><Label htmlFor="c-sloc">SLoc</Label><Input id="c-sloc" name="sap_storage_location" defaultValue={row?.sap_storage_location ?? ""} /></div>
          </div>
          <div><Label htmlFor="c-notes">Catatan</Label><Input id="c-notes" name="notes" defaultValue={row?.notes ?? ""} /></div>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={row?.active ?? true} className="h-4 w-4" />Aktif</label>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Foto wajib di setiap hitungan" (0133): admins switch it, with one confirmation. */
function CountPhotoSwitch({ id, name, on, canEdit }: { id: string; name: string; on: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canEdit) return <span className="text-sm">{on ? "Ya" : "Tidak"}</span>;
  async function run() {
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_set_customer_count_photo", { p_customer: id, p_required: !on });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false); router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>
        <button type="button" role="switch" aria-checked={on} aria-label={`Foto wajib di setiap hitungan untuk ${name}`}
          className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-ckb" : "bg-steel-300"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </DialogTrigger>
      <DialogContent title="Foto wajib di setiap hitungan">
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">
            {on ? `Foto tidak lagi wajib di setiap hitungan ${name}; tetap wajib untuk hitungan 0, barang temuan dan hitung ulang.`
                : `Setiap hitungan stock take ${name} wajib disertai foto, mulai sekarang.`}
          </p>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy}>{busy ? "Menyimpan…" : on ? "Matikan" : "Wajibkan foto"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One line on how a customer counts, for the card and the table. */
function profileText(c: CustomerRow): string {
  return [
    c.count_identity === "MATERIAL_BIN" ? "Hitung per material dan bin (batch = informasi)" : "Hitung per batch",
    c.photo_scope === "BIN" ? "foto per bin" : "foto per baris",
    c.sap_mapping ? (c.sap_mapping.verified ? "pemetaan khusus (terverifikasi)" : "pemetaan khusus (belum terverifikasi)") : "pemetaan umum",
  ].join(" · ");
}

/**
 * "Profil hitung" (0161): how this customer's stock take works. Identity (with or without batch), where the photo goes, and whether it
 * has its own SAP column titles. Admin only; the database validates it again and audits the change with before and after.
 */
function CountProfileDialog({ row }: { row: CustomerRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState(!!row.sap_mapping);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(fd: FormData) {
    setBusy(true); setError(null);
    let mapping: unknown = null;
    if (own) { try { mapping = readMapping(fd, "pm"); } catch (e) { setBusy(false); setError((e as Error).message); return; } }
    const [, err] = await callRpc("ckb_set_customer_count_profile", {
      p_customer: row.id, p_identity: String(fd.get("identity")), p_photo_scope: String(fd.get("scope")), p_mapping: mapping,
    });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false); router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); setOwn(!!row.sap_mapping); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Profil hitung</Button></DialogTrigger>
      <DialogContent title={`Profil hitung ${row.name}`} description="Berlaku untuk sesi stock take yang dibuat sesudahnya. Sesi yang sudah berjalan tidak berubah." className="sm:w-[40rem]">
        <form action={save} className="space-y-4">
          <div>
            <Label htmlFor="cp-identity">Satu tugas hitung =</Label>
            <select id="cp-identity" name="identity" defaultValue={row.count_identity ?? "FULL"} className="flex h-10 w-full rounded-md border border-steel-300 bg-white px-3 text-sm">
              <option value="FULL">material + bin + batch + expired (bawaan)</option>
              <option value="MATERIAL_BIN">material + bin; kode batch hanya informasi (baris SAP yang hanya beda batch digabung)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="cp-scope">Foto</Label>
            <select id="cp-scope" name="scope" defaultValue={row.photo_scope ?? "TASK"} className="flex h-10 w-full rounded-md border border-steel-300 bg-white px-3 text-sm">
              <option value="TASK">per baris hitungan (bawaan)</option>
              <option value="BIN">satu foto per bin; per baris hanya untuk hitungan 0, barang temuan dan hitung ulang</option>
            </select>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} className="h-4 w-4" />
            Pakai pemetaan kolom SAP khusus customer ini (bukan yang umum di Pengaturan)</label>
          {own && <MappingFields prefix="pm" columns={row.sap_mapping?.columns ?? {}} verified={row.sap_mapping?.verified ?? false} />}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
