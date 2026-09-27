"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck, Truck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Alert = { id: number; text: string; href: string; tone: "ok" | "warn" | "bad" };

const TEXT: Record<string, [string, Alert["tone"]]> = {
  COMPLETED: ["selesai", "ok"], CANCELLED: ["dibatalkan", "bad"], RESCHEDULED: ["dijadwal ulang", "warn"], PENDING: ["dilanjutkan", "warn"],
};
const TONE: Record<Alert["tone"], string> = { ok: "border-ok", warn: "border-warn", bad: "border-bad" };

/**
 * Toast on every page when a wave changes status on any device (execution_events
 * insert). Each toast stays 8 s. Tasks are not announced: during
 * "Selesaikan wave" that would be dozens of toasts.
 */
export function WaveAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`wave-alerts:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "execution_events", filter: "entity_type=eq.WAVE" }, async ({ new: ev }) => {
        const { data: w } = await supabase.from("waves").select("wave_no, planned_date, truck").eq("id", ev.entity_id).single();
        if (!w) return;
        const [verb, tone] = TEXT[ev.to_status as string] ?? [String(ev.to_status).toLowerCase(), "warn"];
        const alert: Alert = {
          id: ev.id as number,
          text: `Wave NO ${w.wave_no}${w.truck ? ` (${w.truck})` : ""} ${verb}${ev.reason ? `: ${ev.reason}` : ""}`,
          href: `/waves?date=${w.planned_date}`,
          tone,
        };
        setAlerts((a) => [...a.filter((x) => x.id !== alert.id), alert].slice(-4));
        setTimeout(() => setAlerts((a) => a.filter((x) => x.id !== alert.id)), 8000);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (!alerts.length) return null;
  return (
    <div className="fixed bottom-20 right-3 z-40 flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2 lg:bottom-4" role="status" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.id} className={cn("flex items-start gap-3 rounded-md border-l-4 bg-white p-3 text-sm shadow-lg", TONE[a.tone])}>
          {a.tone === "ok" ? <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <Truck className="mt-0.5 h-4 w-4 shrink-0 text-steel-500" />}
          <Link href={a.href} className="flex-1 hover:underline">{a.text}</Link>
          <button onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))} aria-label="Tutup"><X className="h-4 w-4 text-steel-500" /></button>
        </div>
      ))}
    </div>
  );
}
