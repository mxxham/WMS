"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Notice } from "@/components/ckb/ui";
import { callRpc } from "@/components/ckb/rpc-button";
import { SCOPE_LABEL } from "@/lib/ckb/stocktake";
import { fmtDate, fmtNum } from "@/lib/utils";

type Customer = { id: string; name: string; active_snapshot_id: string | null };
type Import = { id: string; ref_no: string; customer_id: string; snapshot_date: string; row_count: number };

export function NewStocktakeForm({ customers, imports, counters, warehouses, blindDefault }: {
  customers: Customer[]; imports: Import[]; counters: { id: string; name: string }[]; warehouses: string[]; blindDefault: boolean;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [scope, setScope] = useState<keyof typeof SCOPE_LABEL>("FULL");
  const [values, setValues] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => imports.filter((i) => i.customer_id === customer), [imports, customer]);
  const list = values.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);

  function chooseCustomer(id: string) {
    setCustomer(id);
    setSnapshot(customers.find((c) => c.id === id)?.active_snapshot_id ?? imports.find((i) => i.customer_id === id)?.id ?? "");
  }

  async function submit(fd: FormData) {
    setBusy(true); setError(null);
    const [id, err] = await callRpc<string>("ckb_create_stocktake", {
      p_customer: customer, p_import: snapshot, p_scope_type: scope, p_scope_values: scope === "FULL" ? [] : list,
      p_warehouse: String(fd.get("warehouse")), p_blind: fd.get("blind") === "on", p_counters: picked, p_notes: String(fd.get("notes") ?? ""),
    });
    setBusy(false);
    if (err) { setError(err); return; }
    router.push(`/ckb/stock-take/${id}`);
  }

  const chosen = imports.find((i) => i.id === snapshot);
  return (
    <Card>
      <CardContent>
        <form action={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="st-c">Customer</Label>
              <Select id="st-c" required value={customer} onChange={(e) => chooseCustomer(e.target.value)}>
                <option value="">Pilih customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="st-s">Snapshot dasar</Label>
              <Select id="st-s" required value={snapshot} onChange={(e) => setSnapshot(e.target.value)} disabled={!customer}>
                <option value="">{customer && options.length === 0 ? "Belum ada snapshot" : "Pilih snapshot"}</option>
                {options.map((i) => <option key={i.id} value={i.id}>{i.ref_no} · {fmtDate(i.snapshot_date)} · {fmtNum(i.row_count)} baris{customers.find((c) => c.id === customer)?.active_snapshot_id === i.id ? " · aktif" : ""}</option>)}
              </Select>
            </div>
          </div>
          {customer && options.length === 0 && <Notice tone="warn">Customer ini belum punya snapshot SAP. Import dulu di Import SAP.</Notice>}
          {chosen && <p className="text-sm text-steel-500">Sesi ini selamanya dihitung terhadap {chosen.ref_no} (stok SAP {fmtDate(chosen.snapshot_date)}), walau snapshot lain diaktifkan nanti.</p>}

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-steel-700">Cakupan</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((s) => (
                <label key={s} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm ring-1 ${scope === s ? "bg-ckb-tint/40 ring-2 ring-ckb" : "bg-white ring-steel-300 hover:bg-steel-100"}`}>
                  <input type="radio" name="scope" className="sr-only" checked={scope === s} onChange={() => setScope(s)} />{SCOPE_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>
          {scope !== "FULL" && (
            <div>
              <Label htmlFor="st-v">{scope === "BINS" ? "Kode bin" : "Kode material"} (pisahkan dengan spasi, koma atau baris baru)</Label>
              <textarea id="st-v" rows={3} value={values} onChange={(e) => setValues(e.target.value)} className="w-full rounded-md border border-steel-300 bg-white p-2 font-mono text-sm"
                placeholder={scope === "BINS" ? "CG01A01 CG01A02" : "550044709"} />
              <p className="text-xs text-steel-500">{list.length} {scope === "BINS" ? "bin" : "material"}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="st-w">Gudang</Label>
              <Select id="st-w" name="warehouse" defaultValue={warehouses[0]}>{warehouses.map((w) => <option key={w}>{w}</option>)}</Select>
            </div>
            <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" name="blind" defaultChecked={blindDefault} className="h-4 w-4" />
              Hitung buta (operator tidak melihat qty SAP)</label>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-steel-700">Penghitung yang ditugaskan</legend>
            <p className="mb-2 text-xs text-steel-500">Kosong = semua operator CKB boleh menghitung. Supervisor dan admin selalu boleh.</p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {counters.map((c) => (
                <label key={c.id} className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />{c.name}
                </label>
              ))}
              {counters.length === 0 && <p className="text-sm text-steel-500">Belum ada staf CKB dengan peran.</p>}
            </div>
          </fieldset>
          <div><Label htmlFor="st-n">Catatan</Label><Input id="st-n" name="notes" placeholder="mis. opname bulanan Oktober" /></div>

          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button type="submit" disabled={busy || !customer || !snapshot || (scope !== "FULL" && list.length === 0)}>{busy ? "Membuat…" : "Buat sesi (draf)"}</Button>
          <p className="text-xs text-steel-500">Sesi dibuat sebagai draf; tugas hitung dibuat dari snapshot. Penghitungan dimulai dari halaman sesi.</p>
        </form>
      </CardContent>
    </Card>
  );
}
