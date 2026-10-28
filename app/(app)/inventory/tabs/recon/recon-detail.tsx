"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { compareStats, signed } from "@/lib/sap-compare";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { exportRecon } from "./export";
import { Mb51List } from "./mb51-list";
import { ShipmentMatch } from "./shipment-match";
import { StockCompare } from "./stock-compare";
import type { PrevGap, ReconLine, ReconSummary, SapMove, ShipMatch } from "./types";

type View = "stok" | "kirim" | "mb51";

export function ReconDetail({ run, lines, moves, ships, shipError, prev, prevAsOf, initialView }: {
  run: ReconSummary; lines: ReconLine[]; moves: SapMove[]; ships: ShipMatch[]; shipError: string | null;
  prev: PrevGap | null; prevAsOf: string | null; initialView?: string;
}) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [view, setView] = useState<View>(initialView === "kirim" || initialView === "mb51" ? initialView : "stok");
  const [closeNote, setCloseNote] = useState("");
  const s = useMemo(() => compareStats(lines), [lines]);
  const shipOff = ships.filter((r) => r.status !== "MATCH").length;
  const open = run.status === "OPEN";

  function go(v: View) {
    setView(v);
    // Keep the section in the address so a refresh or a shared link opens it.
    const u = new URL(window.location.href);
    u.searchParams.set("rv", v);
    window.history.replaceState(null, "", u.toString());
  }
  async function close(): Promise<string | null> {
    const { error } = await createClient().rpc("close_stock_recon", { p_id: run.id, p_note: closeNote, p_by_name: person });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  const tiles: [string, string, string?, string?][] = [
    ["Akurasi SKU", s.skuAccuracy === null ? "–" : `${fmtNum(s.skuAccuracy, 1)}%`, `${fmtNum(s.match)} dari ${fmtNum(s.skus)} SKU cocok`],
    ["Akurasi qty", s.qtyAccuracy === null ? "–" : `${fmtNum(s.qtyAccuracy, 1)}%`, "1 − total selisih ÷ stok SAP"],
    ["WMS lebih dari SAP", `${fmtNum(s.more)} SKU`, `+${fmtNum(s.moreQty)}`, "text-ckb-dark"],
    ["WMS kurang dari SAP", `${fmtNum(s.less)} SKU`, `−${fmtNum(s.lessQty)}`, "text-bad"],
    ["Hanya di SAP", fmtNum(s.onlySap), "WMS kosong"],
    ["Hanya di WMS", fmtNum(s.onlyWms), "SAP kosong"],
    ["Belum ditangani", fmtNum(s.open), "selisih tanpa status", s.open ? "text-warn" : undefined],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm underline" href="/inventory?tab=rekonsiliasi">← Semua rekonsiliasi</Link>
        <Button variant="outline" size="sm" onClick={() => exportRecon(run, lines, moves, ships, prev)}><Download className="h-4 w-4" />Excel</Button>
      </div>
      <div>
        <h2 className="font-cond text-2xl font-semibold">SAP vs WMS per {fmtDate(run.as_of)}</h2>
        <p className="text-xs text-steel-500">
          {run.file_name} · dibuat {run.created_by_name} {fmtDateTime(run.created_at)}{run.note && ` · ${run.note}`}
          {" · "}SAP acuan, dihitung: <b>{(run.slocs ?? []).join(", ") || "semua lokasi"}</b>
          {(run.other_slocs ?? []).length > 0 && <> · lokasi lain: {(run.other_slocs ?? []).join(", ")}</>}
          {!open && <> · <b>ditutup</b> {fmtDateTime(run.closed_at)} oleh {run.closed_by_name}{run.close_note && `: ${run.close_note}`}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map(([label, value, sub, tone]) => (
          <div key={label} className="rounded-lg bg-white p-3">
            <div className="text-xs text-steel-500">{label}</div>
            <div className={cn("font-cond text-2xl font-semibold tabular", tone)}>{value}</div>
            {sub && <div className={cn("text-xs tabular text-steel-500", tone)}>{sub}</div>}
          </div>
        ))}
      </div>
      <p className="text-sm">
        Total SAP <b className="tabular">{fmtNum(s.sapQty)}</b> · total WMS <b className="tabular">{fmtNum(s.wmsQty)}</b> · beda <b className="tabular">{signed(s.wmsQty - s.sapQty)}</b>
        {s.timingQty !== 0 && <> · koreksi timing <b className="tabular">{signed(s.timingQty)}</b></>}
        {s.otherQty > 0 && <> · SAP di lokasi lain <b className="tabular">{fmtNum(s.otherQty)}</b></>}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-steel-200">
        <div className="flex flex-wrap">
          {([["stok", "Perbandingan stok", s.skus - s.match], ["kirim", "Pengiriman vs GI SAP", shipOff], ["mb51", "Transaksi MB51", moves.length]] as const).map(([k, l, n]) => (
            <button key={k} type="button" onClick={() => go(k)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm", view === k ? "border-ckb font-semibold text-ckb-dark" : "border-transparent text-steel-600 hover:text-steel-900")}>
              {l} <span className="rounded bg-steel-100 px-1.5 text-xs tabular">{fmtNum(n)}</span>
            </button>
          ))}
        </div>
        {open && <div className="pb-2"><PersonNameField id="lperson" value={person} onChange={setPerson} /></div>}
      </div>

      {view === "stok" && <StockCompare run={run} lines={lines} moves={moves} prev={prev} prevAsOf={prevAsOf} person={person} />}
      {view === "kirim" && <ShipmentMatch run={run} rows={ships} error={shipError} person={person} />}
      {view === "mb51" && <Mb51List moves={moves} />}

      {open && (
        <div className="flex flex-wrap items-end gap-2 border-t border-steel-200 pt-4">
          <div className="min-w-72 flex-1">
            <Label htmlFor="cnote">Catatan penutupan {s.open > 0 && "(wajib: masih ada selisih belum ditangani)"}</Label>
            <Input id="cnote" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
          </div>
          <ConfirmButton variant="outline" title="Tutup rekonsiliasi" confirmLabel="Tutup"
            summary={`Tutup rekonsiliasi per ${fmtDate(run.as_of)}: ${fmtNum(s.match)} dari ${fmtNum(s.skus)} SKU cocok, ${fmtNum(s.open)} selisih belum ditangani. Setelah ditutup, baris tidak bisa diubah.`}
            onConfirm={close} disabled={person.trim().length < 2}>Tutup rekonsiliasi</ConfirmButton>
        </div>
      )}
    </div>
  );
}
