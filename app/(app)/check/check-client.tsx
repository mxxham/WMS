"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { unlockAudio } from "@/lib/checker-outcomes";
import { ScanPanel } from "./scan-panel";
import type { Role } from "@/lib/types";

type ShipmentState = "PICKING" | "READY_AUDIT" | "HAS_MISMATCH" | "READY_LOAD" | "LOADED" | "CANCELLED";

export type ShipmentRow = {
  wave_id: string; wave_no: string; planned_date: string; planned_slot: string | null; planned_truck: string | null;
  shipment_number: string; state: ShipmentState; todo: number; ok: number; mismatch: number; resolved: number;
  loaded_at: string | null; loaded_by_name: string | null; truck: string | null; load_legacy: boolean;
  destination: string | null; session_id: string | null; checker_name: string | null; started_at: string | null; seal_number: string | null;
};

export type CheckSession = { id: string; wave_id: string; shipment_number: string; checker_name: string };

const NAME_KEY = "k1.checkerName";

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function chip(row: ShipmentRow, mine: boolean): { label: string; cls: string } {
  if (row.session_id) {
    return mine
      ? { label: `diperiksa oleh saya sejak ${fmtTime(row.started_at)}`, cls: "bg-plate text-steel" }
      : { label: `diperiksa ${row.checker_name ?? "checker lain"} sejak ${fmtTime(row.started_at)}`, cls: "bg-warn text-white" };
  }
  if (row.state === "PICKING") return { label: "masih picking", cls: "bg-steel-100 text-steel-500" };
  if (row.state === "LOADED") return { label: "dimuat", cls: "bg-ckb text-white" };
  if (row.state === "HAS_MISMATCH") return { label: "ada selisih", cls: "bg-bad text-white" };
  if (row.state === "READY_LOAD") return { label: "sudah diperiksa", cls: "bg-ok text-white" };
  return { label: "menunggu", cls: "bg-plate text-steel" };
}

export function CheckClient({ role, staff, today }: { role: Role; staff: string[]; today: string }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "waiting" | "mine" | "checked">("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [session, setSession] = useState<CheckSession | null>(null);
  const [release, setRelease] = useState<ShipmentRow | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? ""); } catch { /* unavailable */ } }, []);
  const pickName = (v: string) => { setName(v); try { localStorage.setItem(NAME_KEY, v); } catch { /* unavailable */ } };

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("check_shipment").select("*").eq("planned_date", date)
      .order("wave_no").order("shipment_number");
    if (error) setMsg({ ok: false, text: error.message });
    else setRows((data ?? []) as ShipmentRow[]);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const myName = name.trim().toLowerCase();
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => r.state !== "CANCELLED")
      .filter((r) => !s || `${r.shipment_number} ${r.wave_no} ${r.truck ?? ""} ${r.planned_truck ?? ""} ${r.destination ?? ""} ${r.wave_id}`.toLowerCase().includes(s))
      .filter((r) => {
        if (filter === "waiting") return !r.session_id && (r.state === "READY_AUDIT" || r.state === "HAS_MISMATCH");
        if (filter === "mine") return !!r.session_id && (r.checker_name ?? "").toLowerCase() === myName && myName !== "";
        if (filter === "checked") return r.state === "LOADED" || (r.state === "READY_LOAD" && !r.session_id);
        return true;
      });
  }, [rows, q, filter, myName]);

  const groups = useMemo(() => {
    const m = new Map<string, ShipmentRow[]>();
    for (const r of visible) {
      const k = `WAVE ${r.wave_no} · ${r.planned_slot ?? "-"}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [visible]);

  const nameOptions = name && !staff.includes(name) ? [name, ...staff] : staff;

  async function start(row: ShipmentRow) {
    if (!name.trim()) { setMsg({ ok: false, text: "Pilih nama checker dulu." }); return; }
    setBusy(true); setMsg(null);
    const { data, error } = await createClient().rpc("check_claim", {
      p_wave_id: row.wave_id, p_shipment: row.shipment_number, p_checker_name: name.trim(),
    });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); void load(); return; }
    unlockAudio();
    const r = data as { session_id: string };
    setSession({ id: r.session_id, wave_id: row.wave_id, shipment_number: row.shipment_number, checker_name: name.trim() });
  }

  async function doRelease() {
    if (!release?.session_id) return;
    setBusy(true); setMsg(null);
    const { error } = await createClient().rpc("check_release", { p_session: release.session_id, p_note: note.trim() });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setRelease(null); setNote(""); void load();
  }

  if (session) {
    return <ScanPanel session={session} onExit={() => { setSession(null); void load(); }} />;
  }

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-52">
            <Label htmlFor="checker">Nama checker</Label>
            <Select id="checker" value={name} onChange={(e) => pickName(e.target.value)}>
              <option value="">— pilih nama —</option>
              {nameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
          <div className="min-w-40">
            <Label htmlFor="date">Tanggal</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-56 flex-1">
            <Label htmlFor="q">Cari</Label>
            <Input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="shipment, wave, truk, tujuan" />
          </div>
          <div className="flex flex-wrap gap-1 pb-1">
            {(["all", "waiting", "mine", "checked"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {f === "all" ? "Semua" : f === "waiting" ? "Menunggu" : f === "mine" ? "Diperiksa saya" : "Sudah"}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {msg && <div className={cn("rounded-md px-3 py-2 text-sm", msg.ok ? "bg-ok text-white" : "bg-bad text-white")}>{msg.text}</div>}

      {groups.length === 0 && <p className="text-sm text-steel-500">Tidak ada shipment untuk filter ini.</p>}

      {groups.map(([key, items]) => (
        <Card key={key}>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="font-cond text-lg font-semibold">{key}</h2>
              <span className="text-sm text-steel-500">{items[0]?.planned_truck ?? items[0]?.truck ?? "-"} · {items[0]?.destination ?? "-"}</span>
            </div>
            <ul className="divide-y divide-steel-100">
              {items.map((r) => {
                const mine = !!r.session_id && (r.checker_name ?? "").toLowerCase() === myName && myName !== "";
                const c = chip(r, mine);
                const disabled = busy || !name.trim() || r.state === "PICKING" || r.state === "LOADED" || (!!r.session_id && !mine);
                return (
                  <li key={r.shipment_number} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-56">
                      <div className="font-cond text-base font-semibold">{r.shipment_number}</div>
                      <span className={cn("mt-1 inline-block rounded-plate px-2 py-0.5 text-xs font-medium", c.cls)}>{c.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {role !== "operator" && r.session_id && !mine && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRelease(r); setNote(""); }}>Lepas</Button>
                      )}
                      <Button size="sm" disabled={disabled} onClick={() => void start(r)}>
                        {mine ? "Lanjut" : "Mulai check"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!release} onOpenChange={(o) => { if (!o) setRelease(null); }}>
        <DialogContent title="Lepas checker" description={release ? `Shipment ${release.shipment_number}` : undefined}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="note">Alasan</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. salah ambil shipment" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setRelease(null)}>Batal</Button>
              <Button disabled={busy || !note.trim()} onClick={() => void doRelease()}>{busy ? "Memproses…" : "Lepas"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
