import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { loadAisle, loadAisles } from "@/lib/stockcheck-data";
import type { RackCheckReport } from "@/lib/stockcheck";
import { cn } from "@/lib/utils";
import { StockCheckClient } from "./stockcheck-client";
import { Reports } from "./reports";

export const dynamic = "force-dynamic";

const REPORT_LIMIT = 100;

/**
 * Cek stok rak: two tabs. `Cek rak`: one aisle bin by bin (bay 01 on top, 40 at the bottom) with what the
 * system holds, to check against the shelf and correct on the spot, or to download as an Excel list for the
 * rack. Not blind: the system's quantity, batch and expiry are shown.
 * `Laporan`: the permanent record of every saved check, system next to shelf (0145).
 */
export default async function StockCheckPage({ searchParams }: { searchParams: Promise<{ aisle?: string; tab?: string }> }) {
  await requirePage("/stockcheck");
  const sp = await searchParams;
  const supabase = await createClient();
  const aisles = await loadAisles(supabase);
  const wanted = (sp.aisle ?? "").toUpperCase();
  const tab = sp.tab === "laporan" ? "laporan" : "cek";

  const tabs = (
    <nav className="flex gap-1 border-b border-steel-100" aria-label="Cek stok rak">
      {([["cek", "Cek rak"], ["laporan", "Laporan"]] as const).map(([id, label]) => (
        <Link key={id} href={id === "cek" ? "/stockcheck" : "/stockcheck?tab=laporan"} aria-current={tab === id ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-4 py-2 font-cond text-lg font-semibold",
            tab === id ? "border-ckb text-ckb" : "border-transparent text-steel-500 hover:text-steel-700")}>
          {label}
        </Link>
      ))}
    </nav>
  );

  if (tab === "laporan") {
    const filter = aisles.includes(wanted) ? wanted : null;
    let q = supabase.from("rack_check_reports")
      .select("id, aisle, created_at, by_name, reason_code, lines, added, movements, aisle_before, aisle_after, warnings, report")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(REPORT_LIMIT);
    if (filter) q = q.eq("aisle", filter);
    const { data, error } = await q;
    return (
      <main>
        <PageHeader title="Cek stok rak" live={["movements"]} liveDebounceMs={10000} />
        <div className="space-y-4 p-4 lg:p-8">
          {tabs}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter rak">
            <span className="text-sm font-medium text-steel-700">Rak</span>
            {[null, ...aisles].map((a) => (
              <Link key={a ?? "all"} href={a ? `/stockcheck?tab=laporan&aisle=${a}` : "/stockcheck?tab=laporan"} aria-current={a === filter ? "page" : undefined}
                className={cn("inline-flex h-10 min-w-12 items-center justify-center rounded-md border px-3 font-cond text-lg font-semibold",
                  a === filter ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white text-steel hover:bg-steel-100")}>
                {a ?? "Semua"}
              </Link>
            ))}
          </div>
          {error
            ? <p role="alert" className="text-sm text-bad">Laporan gagal dimuat: {error.message}</p>
            : <Reports reports={(data ?? []) as unknown as RackCheckReport[]} aisle={filter} limit={REPORT_LIMIT} />}
        </div>
      </main>
    );
  }

  const aisle = aisles.includes(wanted) ? wanted : aisles[0];
  const [{ bins, lines }, { data: items }] = await Promise.all([
    loadAisle(supabase, aisle),
    supabase.from("items").select("sku, description").order("sku"),
  ]);
  return (
    <main>
      <PageHeader title="Cek stok rak" live={["movements"]} liveDebounceMs={10000} />
      <div className="space-y-4 p-4 lg:p-8">
        {tabs}
        {/* Keyed by aisle: what was typed never carries over to another rack. */}
        <StockCheckClient key={aisle} aisle={aisle} aisles={aisles} bins={bins} lines={lines}
          items={(items ?? []) as { sku: string; description: string }[]} />
      </div>
    </main>
  );
}
