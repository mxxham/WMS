"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { impactOf, STATE_TEXT, type Change } from "@/lib/wave-impact";
import { loadSkuContext, type SkuContext } from "./sku-context";

/**
 * "Akan mempengaruhi…" inside a confirmation: the open rows of other waves
 * that get worse if this action is saved (lib/wave-impact.ts). Loads the SKUs'
 * stock and open rows once; `build` turns the dialog's current choice into the
 * change, so the list follows what the supervisor picks.
 */
export function ImpactNote({ skus, build }: { skus: string[]; build: (ctx: SkuContext) => { change: Change; own: string[] } | null }) {
  const [ctx, setCtx] = useState<SkuContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = skus.join(",");
  useEffect(() => {
    let live = true;
    loadSkuContext(key ? key.split(",") : []).then((c) => { if (live) setCtx(c); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [key]);

  if (error) return <p className="text-xs text-steel-500">Dampak ke wave lain tidak terbaca: {error}</p>;
  if (!ctx) return <p className="text-xs text-steel-500">Memeriksa dampak ke wave lain…</p>;
  const plan = build(ctx);
  if (!plan) return null;
  const hits = impactOf(ctx.stock, ctx.tasks, plan.change, plan.own);
  if (!hits.length) return <p className="text-xs text-steel-500">Tidak ada baris wave lain yang terpengaruh.</p>;
  return (
    <div role="alert" className="space-y-1 rounded-md border border-warn bg-warn/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-warn" />Akan mempengaruhi {hits.length} baris wave lain:</p>
      <ul className="list-disc pl-5">
        {hits.map((h) => <li key={h.id}>{h.label}: <b>{STATE_TEXT[h.after]}</b></li>)}
      </ul>
      <p className="text-xs">Setelah disimpan, baris ini muncul di panel <b>Perlu ditangani</b> dengan tombol Perbaiki.</p>
    </div>
  );
}
