"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { ConfirmButton } from "@/components/app/confirm-button";
import { fetchAll } from "@/lib/fetch-all";
import { buildSheet, type SheetStock } from "@/lib/wave-sheet";
import { unitOf, waveProgress, type OrderLine, type UnitQty } from "@/lib/pick-line";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import { cn, fmtNum } from "@/lib/utils";
import { PickLineCard } from "./pick-line-card";

const REASON_LABEL: Record<string, string> = { NO_STOCK: "stok tidak ada", BLOCKED_SHELF_LIFE: "umur simpan kurang", ALREADY_STAGED: "sudah di staging" };

function Units({ units }: { units: UnitQty }) {
  return (
    <div className="space-y-1">{Object.entries(units).map(([unit, q]) => (
      <div key={unit} className="text-sm tabular">
        <div className="flex justify-between"><span>{unit}</span><span><b>{fmtNum(q.picked)}</b>/{fmtNum(q.needed)}</span></div>
        <div className="h-1.5 overflow-hidden rounded bg-steel-100"><div className={cn("h-full", q.picked >= q.needed ? "bg-ok" : "bg-ckb")} style={{ width: `${q.needed ? Math.min(q.picked / q.needed, 1) * 100 : 0}%` }} /></div>
      </div>
    ))}</div>
  );
}

/**
 * Picking (0067): a wave line by line on the phone, in picklist order. Each
 * line posts on its own through post_pick_line; progress shows what the order
 * still needs. Opens in place of the wave's table.
 */
export function PickingPanel({ wave: w, tasks, orders, onClose }: {
  wave: { id: string; wave_no: string; status: string }; tasks: TaskRow[]; orders: OrderLine[]; onClose: () => void;
}) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [stock, setStock] = useState<SheetStock[]>([]);
  // The editor starts its Qty sisa from the stock only once it has loaded (never from an empty list).
  const [stockLoaded, setStockLoaded] = useState(false);
  const [bins, setBins] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = useMemo(() => buildSheet(tasks).lines, [tasks]);
  const progress = useMemo(() => waveProgress(tasks, orders), [tasks, orders]);
  const done = lines.filter((l) => l.posted).length;
  const skus = useMemo(() => [...new Set(tasks.map((t) => t.sku))].sort().join(","), [tasks]);

  async function loadStock() {
    const db = createClient();
    try {
      const [inv, all] = await Promise.all([
        fetchAll<{ bin_code: string; sku: string; batch_lot: string; expiry_date: string | null; quantity: number }>((a, b) =>
          db.from("inventory_detail").select("bin_code, sku, batch_lot, expiry_date, quantity").in("sku", skus.split(",")).order("bin_code").range(a, b)),
        bins ? Promise.resolve(null) : fetchAll<{ bin_code: string }>((a, b) => db.from("bins").select("bin_code").neq("status", "blocked").order("bin_code").range(a, b)),
      ]);
      setStock(inv.map((r) => ({ bin: r.bin_code, sku: r.sku, batch: r.batch_lot, expiry: r.expiry_date, qty: Number(r.quantity) })));
      setStockLoaded(true);
      if (all) setBins(new Set(all.map((b) => b.bin_code)));
    } catch (e) { setError((e as Error).message); }
  }
  // Stock is reloaded whenever the wave's tasks change (a posting, here or by another picker).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadStock(); }, [tasks]);

  function posted(key: string) {
    router.refresh();
    const next = lines.find((l) => !l.posted && l.key !== key);
    if (next) setTimeout(() => document.getElementById(`line-${next.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
  }

  async function close(): Promise<string | null> {
    const { error } = await createClient().rpc("complete_wave_by", { p_wave_id: w.id, p_by_name: person });
    if (error) return error.message;
    router.refresh(); onClose();
    return null;
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>Picking NO {w.wave_no} · {fmtNum(done)}/{fmtNum(lines.length)} baris</CardTitle>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" />Tutup</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama picker (wajib)" />
          <Units units={progress.units} />
          {progress.shipments.length > 1 && progress.shipments.map((s) => (
            <div key={s.shipment} className="text-sm"><b>Shipment {s.shipment}</b>
              {s.open === 0 && (Object.keys(s.lack).length === 0 ? <span className="ml-2 font-semibold text-ok">lengkap</span>
                : <span className="ml-2 font-semibold text-bad">kurang {Object.entries(s.lack).map(([u, n]) => `${fmtNum(n)} ${u}`).join(" · ")}</span>)}
              <Units units={s.units} /></div>
          ))}
          {progress.shipments.length === 1 && progress.shipments[0].open === 0 && (
            Object.keys(progress.shipments[0].lack).length === 0
              ? <p className="text-sm font-semibold text-ok">Order lengkap</p>
              : <p className="text-sm font-semibold text-bad">Order kurang {Object.entries(progress.shipments[0].lack).map(([u, n]) => `${fmtNum(n)} ${u}`).join(" · ")}</p>
          )}
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Per order</summary>
            <ul className="mt-2 space-y-1">{progress.orders.map((o) => (
              <li key={`${o.shipment}|${o.sku}`} className="tabular">
                {o.shipment} · {o.sku} {o.description}: <b>{fmtNum(o.picked)}</b>/{fmtNum(o.needed)} {o.unit}
                {o.lackUnplanned > 0 && <span className="text-bad"> · {fmtNum(o.lackUnplanned)} tidak teralokasi ({REASON_LABEL[o.shortageReason ?? ""] ?? o.shortageReason ?? "kurang stok"})</span>}
                {o.lackShort > 0 && <span className="text-bad"> · {fmtNum(o.lackShort)} kurang dari baris #{o.shortSeqs.join(", #")}</span>}
              </li>
            ))}</ul>
          </details>
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Per picker</summary>
            <ul className="mt-2 space-y-1">{progress.pickers.map((p) => (
              <li key={p.name}>{p.name}: {fmtNum(p.lines)} baris · {Object.entries(p.units).map(([u, n]) => `${fmtNum(n)} ${u}`).join(" · ")}</li>
            ))}</ul>
          </details>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        </CardContent>
      </Card>

      {lines.map((l) => {
        const order = progress.orders.find((o) => o.shipment === (l.shipment ?? "-") && o.sku === l.sku);
        const lastOpen = !l.posted && order && order.openLines === 1 && order.picked + Number(l.pick?.quantity ?? 0) < order.needed;
        return (
          <div key={l.key}>
            <PickLineCard line={l} unit={unitOf(l.sku, l.uom)} stock={stock} stockLoaded={stockLoaded} bins={bins} person={person} waveId={w.id} onPosted={() => posted(l.key)} />
            {lastOpen && <p className="px-1 pt-1 text-xs font-semibold text-bad">masih kurang {fmtNum(order.needed - order.picked - Number(l.pick?.quantity ?? 0))} {order.unit} untuk order ini</p>}
          </div>
        );
      })}

      {w.status === "PENDING" && done === lines.length && lines.length > 0 && (
        <ConfirmButton title={`Tutup NO ${w.wave_no}`} summary="Semua baris sudah diposting. Tandai wave dan order-nya selesai." onConfirm={close}>
          <CheckCheck className="h-4 w-4" />Selesaikan wave
        </ConfirmButton>
      )}
    </div>
  );
}
