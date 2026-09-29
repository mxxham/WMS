"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Tables in the supabase_realtime publication (migration 0015). */
export type LiveTable = "waves" | "pick_tasks" | "outbound" | "movements" | "count_tasks" | "execution_events" | "audits" | "pickfaces"
  | "stock_holds" | "adjustment_requests" | "receipts" | "receipt_actuals" | "stock_recons" | "stock_recon_lines" | "settings" | "items"
  | "pick_audits" | "shipment_loads" | "sheet_pick_lines" | "sheet_pick_audits";
export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Calls onChange (debounced) when any row of `tables` is inserted, updated or
 * deleted. A burst of postings (Selesaikan wave = many rows) becomes one call.
 * While the tab is hidden nothing runs; one catch-up call fires when it is
 * shown again, so a phone left in a pocket does not reload in the background.
 */
export function useLiveTables(tables: LiveTable[], onChange: () => void, debounceMs = 1000): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = [...tables].sort().join(",");

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let missed = false;
    const fire = () => {
      if (document.visibilityState === "hidden") { missed = true; return; }
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && missed) { missed = false; fire(); }
    };
    let channel = supabase.channel(`live:${key}:${Math.random().toString(36).slice(2)}`);
    for (const table of key.split(",")) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, fire);
    }
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") setStatus("live");
      else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setStatus("offline");
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [key, debounceMs]);

  return status;
}

export function LiveDot({ status }: { status: LiveStatus }) {
  const label = status === "live" ? "Live" : status === "offline" ? "Tidak live" : "Menghubungkan";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-steel-500" title={status === "offline" ? "Pembaruan otomatis terputus. Muat ulang halaman." : "Halaman diperbarui otomatis"}>
      <span className={cn("h-2 w-2 rounded-full", status === "live" ? "animate-pulse bg-ok" : status === "offline" ? "bg-bad" : "bg-steel-300")} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Drop into a server-rendered page: re-runs the page's server query when its
 * tables change. Client state (open dialogs, typed values) survives the
 * refresh. `?scan=1` is dropped instead (a navigation, which also refetches) so
 * the update does not log a second scan.
 */
export function LiveRefresh({ tables, debounceMs }: { tables: LiveTable[]; debounceMs?: number }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const status = useLiveTables(tables, () => {
    if (params.has("scan")) {
      const rest = new URLSearchParams(params);
      rest.delete("scan");
      router.replace(rest.size ? `${path}?${rest}` : path);
    } else {
      router.refresh();
    }
  }, debounceMs);
  return <LiveDot status={status} />;
}
