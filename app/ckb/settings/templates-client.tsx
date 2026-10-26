"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Pill } from "@/components/ckb/ui";
import { RpcButton, callRpc } from "@/components/ckb/rpc-button";
import { checklistError, keyFromLabel, type ChecklistItem, type ItemKind } from "@/lib/ckb/inspection";

export type TemplateRow = { id: string; code: string; version: number; name: string; customer_id: string | null; items: ChecklistItem[]; active: boolean; created_at: string };
const KIND: Record<ItemKind, string> = { CHECK: "OK / NG / NA", TEXT: "Teks", NUMBER: "Angka" };

/** Inspection checklists. Saving writes a new version; inspections keep the version they used. */
export function TemplatesClient({ templates, customers }: { templates: TemplateRow[]; customers: { id: string; name: string }[] }) {
  const cname = new Map(customers.map((c) => [c.id, c.name]));
  const codes = [...new Set(templates.map((t) => t.code))];
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Checklist inspeksi</CardTitle>
        <TemplateEditor customers={customers} />
      </CardHeader>
      <CardContent className="space-y-4">
        {codes.map((code) => {
          const versions = templates.filter((t) => t.code === code);
          const current = versions.find((t) => t.active) ?? versions[0];
          return (
            <div key={code} className="rounded-md border border-steel-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{current.name} <span className="text-xs text-steel-500">{code} v{current.version}</span></p>
                  <p className="text-xs text-steel-500">{current.customer_id ? `Khusus ${cname.get(current.customer_id)}` : "Semua customer"} · {current.items.length} butir</p>
                </div>
                <div className="flex items-center gap-2">
                  {current.active ? <Pill tone="ok">Aktif</Pill> : <Pill tone="muted">Tidak aktif</Pill>}
                  <TemplateEditor customers={customers} base={current} />
                  <RpcButton rpc="ckb_set_inspection_template_active" args={{ p_id: current.id, p_active: !current.active }} size="sm" variant="ghost"
                    title={current.active ? "Nonaktifkan checklist" : "Aktifkan checklist"}
                    summary={current.active ? `${current.name} tidak bisa dipakai untuk inspeksi baru. Inspeksi lama tetap utuh.` : `${current.name} v${current.version} dipakai untuk inspeksi baru.`}>
                    {current.active ? "Nonaktifkan" : "Aktifkan"}
                  </RpcButton>
                </div>
              </div>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-steel-700">
                {current.items.map((i) => <li key={i.key}>{i.label} <span className="text-xs text-steel-500">· {i.category ?? "Umum"} · {KIND[i.kind]}{i.required ? " · wajib" : ""}</span></li>)}
              </ol>
              {versions.length > 1 && <p className="mt-1 text-xs text-steel-500">Versi tersimpan: {versions.map((v) => `v${v.version}`).join(", ")}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TemplateEditor({ customers, base }: { customers: { id: string; name: string }[]; base?: TemplateRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>(base?.items ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (i: number, patch: Partial<ChecklistItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => setItems((xs) => { const n = [...xs]; const t = n[i + d]; if (!t) return xs; n[i + d] = n[i]; n[i] = t; return n; });
  const add = () => setItems((xs) => [...xs, { key: keyFromLabel(`butir ${xs.length + 1}`, new Set(xs.map((x) => x.key))), label: "", category: "Umum", required: true, kind: "CHECK" }]);

  async function save(fd: FormData) {
    const problem = checklistError(items);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_save_inspection_template", {
      p_code: base?.code ?? String(fd.get("code") ?? ""), p_name: String(fd.get("name") ?? ""),
      p_customer: String(fd.get("customer") ?? "") || null, p_items: items,
    });
    setBusy(false);
    if (err) { setError(err); return; }
    setOpen(false); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); if (o) setItems(base?.items ?? []); }}>
      <DialogTrigger asChild>{base ? <Button size="sm" variant="outline">Ubah</Button> : <Button size="sm"><Plus className="h-4 w-4" />Checklist baru</Button>}</DialogTrigger>
      <DialogContent title={base ? `Ubah ${base.name}` : "Checklist baru"} description="Menyimpan membuat versi baru; inspeksi yang sudah ada tetap memakai versinya." className="sm:w-[40rem]">
        <form action={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="t-code">Kode</Label><Input id="t-code" name="code" defaultValue={base?.code} disabled={!!base} required={!base} placeholder="UMUM" /></div>
            <div className="sm:col-span-2"><Label htmlFor="t-name">Nama</Label><Input id="t-name" name="name" required defaultValue={base?.name} /></div>
          </div>
          <div><Label htmlFor="t-cust">Berlaku untuk</Label>
            <Select id="t-cust" name="customer" defaultValue={base?.customer_id ?? ""}>
              <option value="">Semua customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <ol className="space-y-2">
            {items.map((it, i) => (
              <li key={it.key} className="rounded-md border border-steel-100 p-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem]">
                  <Input aria-label={`Label butir ${i + 1}`} value={it.label} placeholder="Pertanyaan" onChange={(e) => update(i, { label: e.target.value })} />
                  <Input aria-label={`Kategori butir ${i + 1}`} value={it.category ?? ""} placeholder="Kategori" onChange={(e) => update(i, { category: e.target.value })} />
                  <Select aria-label={`Jenis butir ${i + 1}`} value={it.kind} onChange={(e) => update(i, { kind: e.target.value as ItemKind })}>
                    {(Object.keys(KIND) as ItemKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
                  </Select>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                  <label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={it.required} onChange={(e) => update(i, { required: e.target.checked })} />Wajib</label>
                  <span className="flex gap-1">
                    <Button type="button" size="icon" variant="ghost" aria-label="Naik" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label="Turun" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label="Hapus butir" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <Button type="button" variant="outline" onClick={add}><Plus className="h-4 w-4" />Tambah butir</Button>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan versi baru"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
