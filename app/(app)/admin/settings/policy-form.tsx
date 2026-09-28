"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { POLICY_LABEL, type InventoryPolicy } from "@/lib/inventory-control";
import { cn } from "@/lib/utils";

const NUMBERS = ["default_shelf_life_months", "min_dispatch_days", "near_expiry_days", "adjust_approval_qty", "ira_target_pct", "pick_accuracy_target_pct"] as const;
const FLAGS = ["recount_on_variance", "require_scan_on_pick"] as const;

/** The rules every inventory control reads (inventory_policy, 0016). */
export function PolicyForm({ policy }: { policy: InventoryPolicy }) {
  const router = useRouter();
  const [v, setV] = useState(policy);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg(null);
    const { error } = await createClient().rpc("set_inventory_policy", { p_value: v });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Aturan disimpan. Berlaku untuk alokasi, hitung, penerimaan dan adjustment berikutnya." });
    if (!error) router.refresh();
  }
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Aturan inventory</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {NUMBERS.map((k) => (
            <div key={k}>
              <Label htmlFor={k}>{POLICY_LABEL[k].label}</Label>
              <Input id={k} type="number" min={0} step="any" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
              <p className="mt-1 text-xs text-steel-500">{POLICY_LABEL[k].help}</p>
            </div>
          ))}
          <div>
            <Label>{POLICY_LABEL.count_tolerance_qty.label}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["A", "B", "C"] as const).map((c) => (
                <div key={c}><Label htmlFor={`tol-${c}`} className="text-xs">Kelas {c}</Label>
                  <Input id={`tol-${c}`} type="number" min={0} value={v.count_tolerance_qty[c]} onChange={(e) => setV({ ...v, count_tolerance_qty: { ...v.count_tolerance_qty, [c]: Number(e.target.value) } })} /></div>
              ))}
            </div>
            <p className="mt-1 text-xs text-steel-500">{POLICY_LABEL.count_tolerance_qty.help}</p>
          </div>
          {FLAGS.map((k) => (
            <div key={k}>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{POLICY_LABEL[k].label}</label>
              <p className="mt-1 text-xs text-steel-500">{POLICY_LABEL[k].help}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan aturan"}</Button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
