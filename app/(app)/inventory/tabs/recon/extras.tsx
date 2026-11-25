"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { CLAIM_HEARTBEAT_MS, claimAge, heldByOther, type ReconClaim } from "@/lib/recon-claim";
import type { FixPlan, StockLine } from "@/lib/recon-investigate";
import { gapSeries, repeatStreak, type TrendRow } from "@/lib/recon-trend";
import { signed } from "@/lib/sap-compare";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

const num = (v: unknown) => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------
// Who is on this SKU (0155)
// ---------------------------------------------------------------------
/**
 * Claims the SKU for the typed name while it is open and keeps the claim alive. When somebody else holds a live claim
 * `taken` says who; nothing is blocked. Leaving the SKU releases the claim; a closed tab frees it after 30 minutes.
 */
export function useReconClaim(lineId: string, person: string, active: boolean) {
  const [taken, setTaken] = useState<{ by_name: string; claimed_at: string; last_seen_at: string } | null>(null);
  const holding = useRef(false);
  const name = person.trim();

  const claim = useCallback(async (takeOver = false) => {
    const { data, error } = await createClient().rpc("recon_claim", { p_line_id: lineId, p_by_name: name, p_take_over: takeOver });
    if (error) return; // a job that may not investigate, or an unusable name: no banner
    const r = data as { status: "OK" | "TAKEN"; by_name?: string; claimed_at?: string; last_seen_at?: string };
    if (r.status === "TAKEN") { holding.current = false; setTaken({ by_name: r.by_name ?? "", claimed_at: r.claimed_at ?? "", last_seen_at: r.last_seen_at ?? "" }); }
    else { holding.current = true; setTaken(null); }
  }, [lineId, name]);

  useEffect(() => {
    if (!active || name.length < 2) return;
    const first = window.setTimeout(() => void claim(), 800);
    const beat = window.setInterval(() => void claim(), CLAIM_HEARTBEAT_MS);
    return () => {
      window.clearTimeout(first); window.clearInterval(beat);
      if (holding.current) { holding.current = false; void createClient().rpc("recon_release", { p_line_id: lineId, p_by_name: name }); }
    };
  }, [active, name, lineId, claim]);

  return { taken, takeOver: () => claim(true) };
}

export function ClaimBanner({ taken, onTakeOver, onBack }: {
  taken: { by_name: string; last_seen_at: string } | null; onTakeOver: () => Promise<void>; onBack: () => void;
}) {
  if (!taken) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn bg-warn/15 p-3 text-sm">
      <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <span><b>{taken.by_name}</b> sedang memeriksa SKU ini (aktif {claimAge(taken.last_seen_at)}). Kalau Anda tetap lanjut, cek dan koreksi kalian bisa saling menimpa.</span></p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onBack}>Kembali ke daftar</Button>
        <Button size="sm" onClick={() => void onTakeOver()}>Ambil alih</Button>
      </div>
    </div>
  );
}

/** "Dicek oleh Ani": a SKU somebody else has open. */
export function ClaimChip({ claim, person }: { claim: ReconClaim | undefined; person: string }) {
  if (!claim || !heldByOther(claim, person)) return null;
  return (
    <div className="mt-1"><span className="rounded bg-warn/25 px-1.5 py-0.5 text-xs font-semibold text-steel-900" title={`Terakhir aktif ${claimAge(claim.last_seen_at)}`}>
      Dicek oleh {claim.by_name} · {claimAge(claim.last_seen_at)}</span></div>
  );
}

// ---------------------------------------------------------------------
// The gap of this SKU over the reconciliations
// ---------------------------------------------------------------------
/** Bars of the SKU's gap per reconciliation (red = WMS less than SAP, blue = more) and how long it keeps coming back. */
export function GapTrend({ sku }: { sku: string }) {
  const [rows, setRows] = useState<TrendRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void createClient().from("stock_recon_lines").select("recon_id, diff_unrestricted, diff_blocked, wms_fix, stock_recons(as_of)").eq("sku", sku)
      .then(({ data }) => {
        if (!live) return;
        setRows(((data ?? []) as unknown as { recon_id: string; diff_unrestricted: number | null; diff_blocked: number | null; wms_fix: number | null; stock_recons: { as_of: string } | null }[])
          .filter((r) => r.stock_recons).map((r) => ({ recon_id: r.recon_id, as_of: r.stock_recons!.as_of, diff_unrestricted: r.diff_unrestricted, diff_blocked: r.diff_blocked, wms_fix: r.wms_fix })));
      });
    return () => { live = false; };
  }, [sku]);
  if (!rows) return <p className="text-xs text-steel-500">Memuat tren selisih…</p>;
  const series = gapSeries(rows);
  if (series.length < 2) return <p className="text-xs text-steel-500">Tren selisih: SKU ini baru ada di satu rekonsiliasi.</p>;

  const streak = repeatStreak(series);
  const slot = 30, half = 36;
  const max = Math.max(1, ...series.map((p) => Math.abs(p.gap)));
  return (
    <div className="space-y-1 rounded-lg bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Tren selisih · {series.length} rekonsiliasi terakhir</p>
        {streak.runs >= 2
          ? <p className="text-xs font-semibold text-bad">Berulang {streak.runs} rekonsiliasi berturut-turut ({streak.sign > 0 ? "WMS lebih" : "WMS kurang"})</p>
          : <p className="text-xs text-steel-500">{streak.runs === 0 ? "Rekonsiliasi terakhir cocok" : "Baru muncul di rekonsiliasi terakhir"}</p>}
      </div>
      <svg viewBox={`0 0 ${series.length * slot} ${half * 2 + 14}`} className="h-28 w-full max-w-xl" role="img" aria-label={`Selisih ${sku}: ${series.map((p) => `${fmtDate(p.asOf)} ${signed(p.gap)}`).join(", ")}`}>
        <line x1={0} x2={series.length * slot} y1={half} y2={half} stroke="currentColor" strokeOpacity={0.25} />
        {series.map((p, i) => {
          const h = p.gap === 0 ? 2 : Math.max(2, Math.round((Math.abs(p.gap) / max) * (half - 6)));
          const x = i * slot + 6;
          return (
            <g key={p.reconId}>
              <rect x={x} y={p.gap >= 0 ? half - h : half} width={slot - 12} height={h} rx={2}
                className={p.gap > 0 ? "fill-ckb" : p.gap < 0 ? "fill-bad" : "fill-ok"}>
                <title>{`${fmtDate(p.asOf)}: ${signed(p.gap)}${p.fix ? ` (selisih hari itu ${signed(p.dayGap)}, dikoreksi ${signed(p.fix)})` : ""}`}</title>
              </rect>
              <text x={x + (slot - 12) / 2} y={half * 2 + 10} textAnchor="middle" fontSize={10} className="fill-steel-500">{fmtDate(p.asOf).slice(0, 5)}</text>
            </g>
          );
        })}
      </svg>
      <p className="text-xs tabular text-steel-700">{series.map((p) => signed(p.gap)).join(" · ")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// What a check would do, before it is saved (0156)
// ---------------------------------------------------------------------
export type PreviewResult = { check: { counted: number; system: number; diff: number }; plan: FixPlan };
type PreviewState = { state: "idle" | "loading" | "ok" | "error"; data?: PreviewResult; msg?: string };

/**
 * Asks the database for the plan this check would give: the same planner as the real fix, run on the check and rolled
 * back, so the number shown is the one that gets posted, not an estimate.
 */
export function useCheckPreview(a: { lineId: string; binCode: string; lines: StockLine[] | null; person: string; enabled: boolean }): PreviewState {
  const [res, setRes] = useState<PreviewState>({ state: "idle" });
  const seq = useRef(0);
  const key = JSON.stringify(a.lines);
  const name = a.person.trim();
  useEffect(() => {
    if (!a.enabled || a.lines === null || name.length < 2) { setRes({ state: "idle" }); return; }
    const id = ++seq.current;
    setRes((r) => ({ ...r, state: "loading" }));
    const t = window.setTimeout(async () => {
      const { data, error } = await createClient().rpc("recon_check_preview", { p_line_id: a.lineId, p_bin_code: a.binCode, p_lines: a.lines, p_by_name: name });
      if (id !== seq.current) return;
      setRes(error ? { state: "error", msg: error.message } : { state: "ok", data: data as PreviewResult });
    }, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.lineId, a.binCode, key, name, a.enabled]);
  return res;
}

/** "Kalau disimpan: selisih +8 → 0 · adjustment -8", with what would hold the fix back. */
export function PreviewNote({ res }: { res: PreviewState }) {
  if (res.state === "idle") return null;
  if (res.state === "error") return <p className="text-xs text-steel-500">Perkiraan belum bisa dihitung: {res.msg}</p>;
  if (!res.data) return <p className="text-xs text-steel-500">Menghitung dampak…</p>;
  const p = res.data.plan;
  const before = num(p.gap_before), after = num(p.gap_after);
  const tone = (g: number) => (g === 0 ? "text-ok" : g > 0 ? "text-ckb-dark" : "text-bad");
  const parts = [
    num(p.transfer_qty) > 0 ? `${fmtNum(num(p.transfer_qty))} karton pindah antar bin` : "",
    p.adjustments.length > 0 ? `adjustment ${signed(num(p.net_adjust))}` : "",
  ].filter(Boolean);
  return (
    <div className={cn("rounded-md border border-steel-200 bg-paper p-2 text-xs", res.state === "loading" && "opacity-60")} aria-live="polite">
      <p className="tabular"><b>Kalau disimpan</b> (bersama cek bin lain): selisih dengan SAP <span className={tone(before)}>{signed(before)}</span> → <b className={tone(after)}>{signed(after)}</b>
        {parts.length > 0 ? ` · ${parts.join(" · ")}` : " · tidak ada koreksi dari hasil ini"}</p>
      {p.blockers.map((b, i) => <p key={i} className="mt-1 text-bad">{b}</p>)}
      {p.needs_other_person && <p className="mt-1 text-warn">Adjustment {fmtNum(num(p.adjust_abs))} karton di atas batas {fmtNum(num(p.limit))}: harus diterapkan orang lain dari pengecek.</p>}
    </div>
  );
}
