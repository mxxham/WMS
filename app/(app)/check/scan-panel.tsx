"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle, Camera, ArrowLeft, RotateCw, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { CHECK_OUTCOME_META, OUTCOME_TONE_CLASS, playOutcome, type CheckOutcome } from "@/lib/checker-outcomes";
import type { CheckSession } from "./check-client";

const CheckCameraScanner = dynamic(
  () => import("@/components/scan/check-camera").then((m) => m.CheckCameraScanner),
  { ssr: false },
);

const ICON = { check: CheckCircle2, question: HelpCircle, wrong: XCircle, over: AlertTriangle } as const;

type FinishLine = { task_id: string; sku: string; description: string; required: number; counted: number; errors: string[]; line_state: string };
type FinishResult = {
  status: "passed" | "exception" | "released"; todo: number; ok: number; mismatch: number; resolved: number;
  over_scans: { sku: string; n: number }[]; wrong_items: number; unknown_barcodes: number; lines: FinishLine[]; already: boolean;
};

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function ScanPanel({ session, onExit }: { session: CheckSession; onExit: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [counts, setCounts] = useState<{ sku: string; n: number }[]>([]);
  const [last, setLast] = useState<{ outcome: CheckOutcome; sku: string | null; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ code: string; id: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [seal, setSeal] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState<FinishResult | null>(null);

  const fetchCounts = useCallback(async () => {
    const { data } = await createClient().from("check_scans").select("sku,outcome").eq("session_id", session.id);
    const m = new Map<string, number>();
    for (const r of (data ?? []) as { sku: string | null; outcome: string }[]) {
      if (r.outcome === "ACCEPTED" && r.sku) m.set(r.sku, (m.get(r.sku) ?? 0) + 1);
    }
    setCounts([...m.entries()].map(([sku, n]) => ({ sku, n })).sort((a, b) => a.sku.localeCompare(b.sku)));
  }, [session.id]);

  useEffect(() => { void fetchCounts(); inputRef.current?.focus(); }, [fetchCounts]);

  async function scan(rawCode: string, clientId?: string) {
    const c = rawCode.trim();
    if (!c || busy) return;
    const id = clientId ?? newId();
    setBusy(true); setError(null); setCode("");
    const { data, error: err } = await createClient().rpc("check_scan", {
      p_session: session.id, p_barcode: c, p_client_scan_id: id,
    });
    setBusy(false);
    if (err) {
      setError("Gagal mengirim scan. Periksa jaringan, lalu tekan Ulangi — tidak akan dihitung dua kali.");
      setPending({ code: c, id });
      inputRef.current?.focus();
      return;
    }
    setPending(null);
    const r = data as { outcome: CheckOutcome; sku: string | null; code: string };
    setLast({ outcome: r.outcome, sku: r.sku, code: r.code });
    playOutcome(r.outcome);
    await fetchCounts();
    inputRef.current?.focus();
  }

  async function finish() {
    setFinishing(true); setError(null);
    const { data, error: err } = await createClient().rpc("check_finish", {
      p_session: session.id, p_seal_number: seal.trim() || null,
    });
    setFinishing(false);
    if (err) { setError(err.message); return; }
    setResult(data as FinishResult);
  }

  if (result) return <ResultPanel result={result} session={session} onExit={onExit} />;

  const meta = last ? CHECK_OUTCOME_META[last.outcome] : null;
  const Icon = meta ? ICON[meta.icon] : null;

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-cond text-xl font-semibold">Shipment {session.shipment_number}</div>
          <div className="text-sm text-steel-500">Checker: {session.checker_name}</div>
        </div>
        <Button variant="outline" onClick={onExit}><ArrowLeft className="mr-1 h-4 w-4" />Ganti order</Button>
      </div>

      {meta && Icon && (
        <div className={cn("flex items-center justify-center gap-3 rounded-lg px-4 py-6 text-center", OUTCOME_TONE_CLASS[meta.tone])}>
          <Icon className="h-8 w-8 shrink-0" />
          <div>
            <div className="font-cond text-2xl font-semibold">{meta.label}</div>
            <div className="text-sm opacity-90">{last?.code}</div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="space-y-2">
          <Label htmlFor="scan">Scan karton</Label>
          <div className="flex gap-1">
            <Input id="scan" ref={inputRef} autoFocus value={code} inputMode="numeric" disabled={busy}
              placeholder="Pindai / ketik lalu Enter"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void scan((e.target as HTMLInputElement).value); } }} />
            <Button type="button" size="icon" variant="outline" aria-label="Pindai dengan kamera" onClick={() => setCamera((v) => !v)}><Camera className="h-4 w-4" /></Button>
          </div>
          {camera && <div className="mt-2"><CheckCameraScanner onResult={(t) => void scan(t)} /></div>}
          {error && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-bad px-3 py-2 text-sm text-white">
              <span>{error}</span>
              {pending && <Button size="sm" variant="outline" disabled={busy} onClick={() => void scan(pending.code, pending.id)}><RotateCw className="mr-1 h-3 w-3" />Ulangi</Button>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="mb-2 text-sm text-steel-500">Jumlah discan per SKU</div>
          <Table>
            <thead><tr><Th>SKU</Th><Th>Discan</Th></tr></thead>
            <tbody>
              {counts.length === 0 && <tr><Td className="text-steel-500" colSpan={2}>Belum ada scan.</Td></tr>}
              {counts.map((c) => <tr key={c.sku}><Td className="font-semibold">{c.sku}</Td><Td>{c.n}</Td></tr>)}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-52">
            <Label htmlFor="seal">No. segel (opsional)</Label>
            <Input id="seal" value={seal} onChange={(e) => setSeal(e.target.value)} placeholder="mis. SEAL-001" />
          </div>
          <Button disabled={finishing || busy} onClick={() => void finish()}>
            <Check className="mr-1 h-4 w-4" />{finishing ? "Memproses…" : "Selesaikan check"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultPanel({ result, session, onExit }: { result: FinishResult; session: CheckSession; onExit: () => void }) {
  const overs = result.over_scans.reduce((s, o) => s + o.n, 0);
  const passed = result.status === "passed";
  return (
    <div className="space-y-4 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-cond text-xl font-semibold">Shipment {session.shipment_number}</div>
        <Button variant="outline" onClick={onExit}><ArrowLeft className="mr-1 h-4 w-4" />Kembali</Button>
      </div>
      <div className={cn("rounded-lg px-4 py-5 text-center", passed ? "bg-ok text-white" : "bg-bad text-white")}>
        <div className="font-cond text-2xl font-semibold">{passed ? "Lulus — siap muat" : "Ada selisih"}</div>
        <div className="text-sm opacity-90">{passed ? "Semua baris cocok." : "Perbaiki di lantai lalu check ulang, atau supervisor menerima selisih."}</div>
      </div>
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Kurang" value={result.mismatch} bad={result.mismatch > 0} />
          <Stat label="Lebih (scan ditolak)" value={overs} bad={overs > 0} />
          <Stat label="Barang salah" value={result.wrong_items} bad={result.wrong_items > 0} />
          <Stat label="Barcode tak dikenal" value={result.unknown_barcodes} bad={result.unknown_barcodes > 0} />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Table sticky>
            <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th>Wajib</Th><Th>Discan</Th><Th>Hasil</Th></tr></thead>
            <tbody>{result.lines.map((l) => (
              <tr key={l.task_id}>
                <Td className="font-semibold">{l.sku}</Td>
                <Td>{l.description}</Td>
                <Td>{l.required}</Td>
                <Td>{l.counted}</Td>
                <Td className={l.errors.length ? "text-bad" : "text-ok"}>{l.errors.length ? l.errors.join(", ") : l.line_state}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <div className="rounded-md bg-steel-100 px-3 py-2">
      <div className="text-xs text-steel-500">{label}</div>
      <div className={cn("font-cond text-2xl font-semibold", bad ? "text-bad" : "text-steel")}>{value}</div>
    </div>
  );
}
