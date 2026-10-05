"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { fmtDate, fmtNum } from "@/lib/utils";

/** A wave of an earlier date whose open tasks still reserve stock and bring in Bin To Bin moves. */
export type StaleWave = { id: string; wave_no: string; planned_date: string; status: "PENDING" | "RESCHEDULED"; shipments: string[]; open: number };

/**
 * Waves dated before `before` that are still open (PENDING) or parked (Tunda)
 * AND still have open tasks — exactly the tasks planning_stock (0044) keeps:
 * their picks reserve stock and their Bin To Bin rows count as incoming. A
 * wave whose rows are all posted moves no more stock and is not listed, so
 * it is never cancelled by mistake here.
 */
export async function loadStaleWaves(db: SupabaseClient, before: string): Promise<StaleWave[]> {
  const { data: waves, error } = await db.from("waves").select("id, wave_no, planned_date, status, shipment_numbers")
    .lt("planned_date", before).in("status", ["PENDING", "RESCHEDULED"]).order("planned_date").range(0, 999);
  if (error) throw new Error(error.message);
  const ws = (waves ?? []) as { id: string; wave_no: string; planned_date: string; status: StaleWave["status"]; shipment_numbers: string[] }[];
  if (!ws.length) return [];
  const { data: tasks, error: e2 } = await db.from("pick_tasks").select("wave_id")
    .in("wave_id", ws.map((w) => w.id)).eq("status", "PLANNED").range(0, 9999);
  if (e2) throw new Error(e2.message);
  const open = new Map<string, number>();
  for (const t of (tasks ?? []) as { wave_id: string }[]) open.set(t.wave_id, (open.get(t.wave_id) ?? 0) + 1);
  return ws.filter((w) => (open.get(w.id) ?? 0) > 0)
    .map((w) => ({ id: w.id, wave_no: w.wave_no, planned_date: w.planned_date, status: w.status, shipments: w.shipment_numbers ?? [], open: open.get(w.id) ?? 0 }))
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || Number(a.wave_no) - Number(b.wave_no));
}

/**
 * 5 Oct: a database run planned around 23 open waves of 1-2 Oct — their picks
 * hid real stock and their Bin To Bin moves made empty pickfaces look full —
 * and 108 of 206 rows differed from the WMS file. This lists those waves
 * before planning (Alokasi) and after a full import (the file already shows
 * what was picked), with one button per kind to cancel them. Parked (Tunda)
 * waves are listed apart: their stock is held on purpose until the order
 * comes back, so cancelling them is a separate choice.
 */
export function StaleWavesNotice({ before, onChange, intro }: {
  before: string; intro: string;
  /** Called with the open (not parked) waves after every load, so a page can gate a database run on them. */
  onChange?: (pending: StaleWave[]) => void;
}) {
  const [waves, setWaves] = useState<StaleWave[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await loadStaleWaves(createClient(), before);
      setWaves(list); setError(null);
      onChange?.(list.filter((w) => w.status === "PENDING"));
    } catch (e) { setError((e as Error).message); }
  }, [before, onChange]);
  useEffect(() => { void load(); }, [load]);

  async function cancel(list: StaleWave[]): Promise<string | null> {
    const db = createClient();
    const failed: string[] = [];
    for (const w of list) {
      const { error } = await db.rpc("set_wave_status", {
        p_wave_id: w.id, p_status: "CANCELLED", p_reason: `wave lama dibatalkan sebelum merencanakan ${before}`,
      });
      if (error) failed.push(`NO ${w.wave_no} (${fmtDate(w.planned_date)}): ${error.message}`);
    }
    await load();
    return failed.length ? `${list.length - failed.length} dibatalkan, ${failed.length} gagal: ${failed.join("; ")}` : null;
  }

  if (error) return <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">Wave lama tidak terbaca: {error}</p>;
  if (!waves?.length) return null;
  const pending = waves.filter((w) => w.status === "PENDING");
  const parked = waves.filter((w) => w.status === "RESCHEDULED");
  const tasks = (list: StaleWave[]) => list.reduce((a, w) => a + w.open, 0);
  const names = (list: StaleWave[]) => list.map((w) => `NO ${w.wave_no} (${fmtDate(w.planned_date)})`).join(", ");
  return (
    <div role="alert" className="space-y-3 rounded-md border border-warn bg-warn/10 p-4 text-sm">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
        {waves.length} wave dari tanggal sebelumnya masih terbuka ({fmtNum(tasks(waves))} tugas belum diposting).
      </p>
      <p>{intro}</p>
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {waves.map((w) => (
          <li key={w.id} className="flex flex-wrap gap-x-3">
            <Link href={`/waves?date=${w.planned_date}`} className="font-semibold underline">NO {w.wave_no} · {fmtDate(w.planned_date)}</Link>
            <span>{w.status === "RESCHEDULED" ? "Ditunda" : "Belum selesai"}</span>
            <span>{fmtNum(w.open)} tugas terbuka</span>
            {w.shipments.length > 0 && <span className="text-steel-500">SH {w.shipments.join(", ")}</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-steel-500">
        Sudah dikirim? Posting sisanya atau Selesaikan wave di halaman wave. Tidak jadi? Batalkan. Baris yang sudah diposting tetap tercatat.
        {parked.length > 0 && " Wave ditunda sengaja menahan stok untuk ordernya; batalkan hanya bila ordernya tidak kembali."}
      </p>
      <div className="flex flex-wrap gap-2">
        {pending.length > 0 && (
          <ConfirmButton size="sm" variant="outline" title="Batalkan wave lama" confirmLabel={`Batalkan ${pending.length} wave`}
            summary={`Batalkan ${pending.length} wave belum selesai (${fmtNum(tasks(pending))} tugas terbuka): ${names(pending)}. Tugas yang belum diposting dibatalkan; yang sudah diposting tetap.`}
            onConfirm={() => cancel(pending)}>Batalkan {pending.length} wave belum selesai</ConfirmButton>
        )}
        {parked.length > 0 && (
          <ConfirmButton size="sm" variant="ghost" title="Batalkan wave ditunda" confirmLabel={`Batalkan ${parked.length} wave`}
            summary={`Batalkan ${parked.length} wave ditunda (${fmtNum(tasks(parked))} tugas terbuka): ${names(parked)}. Stok yang ditahan untuk order ini dilepas.`}
            onConfirm={() => cancel(parked)}>Batalkan juga {parked.length} wave ditunda</ConfirmButton>
        )}
      </div>
    </div>
  );
}
