"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Database } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn, fmtNum } from "@/lib/utils";

export type StockBasisInfo = { importedAt: string | null; importedDay: string | null; since: number };

const jakartaDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/**
 * What the database's stock rests on: the last WMS import and the postings
 * since. 6 Oct: Alokasi ran on 5 Oct's import while K_ONE came from 6 Oct's
 * file, and 46 of 133 lines differed. Planning for a day whose file was not
 * imported (or compared) is then a visible, deliberate choice.
 */
export function useStockBasis(): StockBasisInfo | null {
  const [info, setInfo] = useState<StockBasisInfo | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const db = createClient();
      const { data } = await db.from("movements").select("created_at").like("note", "IMPORT %").order("created_at", { ascending: false }).limit(1);
      const at = (data?.[0]?.created_at as string | undefined) ?? null;
      let since = 0;
      if (at) {
        const { count } = await db.from("movements").select("id", { count: "exact", head: true }).gt("created_at", at);
        since = count ?? 0;
      }
      if (live) setInfo({ importedAt: at, importedDay: at ? jakartaDay(at) : null, since });
    })();
    return () => { live = false; };
  }, []);
  return info;
}

export function StockBasis({ info, day, className }: { info: StockBasisInfo | null; day: string; className?: string }) {
  if (!info) return <p className={cn("text-sm text-steel-500", className)}>Memeriksa dasar stok…</p>;
  const when = info.importedAt
    ? new Date(info.importedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const stale = info.importedDay !== day;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-sm", stale ? "bg-warn/10" : "bg-paper", className)}>
      {stale ? <AlertTriangle className="h-4 w-4 text-warn" /> : <Database className="h-4 w-4 text-steel-500" />}
      <span>
        Stok per <b>{when ? `impor ${when}` : "— belum pernah impor"}</b>
        {info.importedAt && <> + <b className="tabular">{fmtNum(info.since)}</b> mutasi sejak itu</>}.
      </span>
      {stale && (
        <span>
          File WMS {day} belum diimpor: picklist dari database bisa beda dengan file.{" "}
          <Link href="/admin/import" className="font-semibold underline">Impor / Bandingkan dulu</Link>
        </span>
      )}
    </p>
  );
}
