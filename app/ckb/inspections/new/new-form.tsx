"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { callRpc } from "@/components/ckb/rpc-button";
import { INSPECTION_TYPE, type InspectionType } from "@/lib/ckb/inspection";

type Template = { id: string; code: string; version: number; name: string; customer_id: string | null };
type Previous = { id: string; ref_no: string; customer_id: string; inspection_type: string; source_ref: string | null; warehouse: string; location: string | null;
  material_code: string | null; material_desc: string | null; batch: string | null; package_ref: string | null };
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export function NewInspectionForm({ customers, templates, warehouses, previous }: { customers: { id: string; name: string }[]; templates: Template[]; warehouses: string[]; previous: Previous | null }) {
  const router = useRouter();
  const [customer, setCustomer] = useState(previous?.customer_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usable = templates.filter((t) => !t.customer_id || t.customer_id === customer);

  async function submit(fd: FormData) {
    setBusy(true); setError(null);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const [id, err] = await callRpc<string>("ckb_create_inspection", {
      p_customer: customer, p_type: s("type"), p_template: s("template"), p_source_ref: s("source_ref"), p_date: s("date"),
      p_warehouse: s("warehouse"), p_location: s("location"), p_material: s("material"), p_material_desc: s("material_desc"),
      p_batch: s("batch"), p_package_ref: s("package_ref"), p_supersedes: previous?.id ?? null,
    });
    setBusy(false);
    if (err) { setError(err); return; }
    router.push(`/ckb/inspections/${id}`);
  }

  return (
    <Card>
      <CardContent>
        <form action={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="in-c">Customer</Label>
              <Select id="in-c" required value={customer} onChange={(e) => setCustomer(e.target.value)} disabled={!!previous}>
                <option value="">Pilih customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="in-t">Jenis</Label>
              <Select id="in-t" name="type" defaultValue={previous?.inspection_type ?? "INBOUND"}>
                {(Object.keys(INSPECTION_TYPE) as InspectionType[]).map((k) => <option key={k} value={k}>{INSPECTION_TYPE[k]}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="in-tpl">Checklist</Label>
              <Select id="in-tpl" name="template" required>
                {usable.map((t) => <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>)}
              </Select>
            </div>
            <div><Label htmlFor="in-d">Tanggal</Label><Input id="in-d" name="date" type="date" required defaultValue={today()} max={today()} /></div>
            <div><Label htmlFor="in-ref">No. dokumen (DO / pengiriman / WO)</Label><Input id="in-ref" name="source_ref" defaultValue={previous?.source_ref ?? ""} /></div>
            <div><Label htmlFor="in-w">Gudang</Label><Select id="in-w" name="warehouse" defaultValue={previous?.warehouse ?? warehouses[0]}>{warehouses.map((w) => <option key={w}>{w}</option>)}</Select></div>
            <div><Label htmlFor="in-loc">Lokasi / dock / bin</Label><Input id="in-loc" name="location" defaultValue={previous?.location ?? ""} /></div>
            <div><Label htmlFor="in-pkg">Ref kemasan / palet</Label><Input id="in-pkg" name="package_ref" defaultValue={previous?.package_ref ?? ""} /></div>
            <div><Label htmlFor="in-m">Material</Label><Input id="in-m" name="material" defaultValue={previous?.material_code ?? ""} autoCapitalize="characters" /></div>
            <div><Label htmlFor="in-b">Batch</Label><Input id="in-b" name="batch" defaultValue={previous?.batch ?? ""} /></div>
            <div className="sm:col-span-2"><Label htmlFor="in-md">Deskripsi material / kargo</Label><Input id="in-md" name="material_desc" defaultValue={previous?.material_desc ?? ""} /></div>
          </div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button type="submit" disabled={busy || !customer || usable.length === 0}>{busy ? "Membuat…" : "Buat dan isi checklist"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
