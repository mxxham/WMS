import type { Metadata } from "next";
import { getCkbUser } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { isLead, isStaff } from "@/lib/ckb/permissions";
import { pickGreeting } from "@/components/app/about-copy";
import { CkbHome, type BoardItem } from "@/components/ckb/ckb-home";
import { jakartaToday } from "@/lib/ckb/housekeeping";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Beranda" };

type Counts = Record<string, number>;
const n = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const fmt = (v: number) => v.toLocaleString("id-ID");

/**
 * CKB 3PL home. The four counts come from the same sources as the dashboard (`ckb_dashboard`, `ckb_hk_dashboard`) and, for a customer,
 * from their own RLS-filtered records. A count that cannot be read shows 0 rather than breaking the page: the home must always open.
 */
export default async function CkbHomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCkbUser();
  if (!user?.ckbRole) return null;   // the layout explains a missing role
  const role = user.ckbRole;
  const sp = await searchParams;
  const db = await createClient();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23" }).format(new Date()).slice(0, 2));
  const today = jakartaToday();
  const dateLine = new Date(`${today}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

  let board: BoardItem[];
  if (isStaff(role)) {
    const [{ data: dash }, { data: hk }] = await Promise.all([db.rpc("ckb_dashboard", { p_customer: null }), db.rpc("ckb_hk_dashboard", { p_customer: null })]);
    const d = (dash ?? {}) as Counts, h = (hk ?? {}) as Counts;
    board = isLead(role)
      ? [
        { value: `${fmt(n(h.done_today))}/${fmt(n(h.expected_today))}`, label: "Housekeeping selesai hari ini", href: "/ckb/housekeeping" },
        { value: fmt(n(d.stocktakes_counting)), label: "Sesi stock take berjalan", href: "/ckb/stock-take?status=COUNTING" },
        { value: fmt(n(d.rebagging_open)), label: "Rebagging terbuka", href: "/ckb/rebagging" },
        { value: fmt(n(d.discrepancies_awaiting_review) + n(d.inspections_awaiting_review) + n(h.awaiting_review) + n(h.awaiting_verify)), label: "Menunggu tinjauan", href: "/ckb/dashboard" },
      ]
      : [
        { value: fmt(n(d.tasks_awaiting_count)), label: "Tugas hitung menunggu", href: "/ckb/count" },
        { value: `${fmt(n(h.done_today))}/${fmt(n(h.mine_today))}`, label: "Rak saya hari ini", href: "/ckb/housekeeping" },
        { value: fmt(n(d.rebagging_open)), label: "Rebagging terbuka", href: "/ckb/rebagging" },
        { value: fmt(n(d.inspections_draft)), label: "Inspeksi draf", href: "/ckb/inspections" },
      ];
  } else {
    const customer = user.customerIds[0] ?? null;
    const [{ data: hk }, sessions, inspections] = await Promise.all([
      customer ? db.rpc("ckb_hk_dashboard", { p_customer: customer }) : Promise.resolve({ data: null }),
      db.from("ckb_stocktakes").select("id", { count: "exact", head: true }),
      db.from("ckb_inspections").select("id", { count: "exact", head: true }),
    ]);
    const h = (hk ?? {}) as Counts;
    board = [
      { value: `${fmt(n(h.done_today))}/${fmt(n(h.expected_today))}`, label: "Housekeeping selesai hari ini", href: "/ckb/housekeeping" },
      { value: fmt(n(h.open_findings)), label: "Temuan terbuka", href: "/ckb/housekeeping" },
      { value: fmt(sessions.count ?? 0), label: "Stock take selesai", href: "/ckb/stock-take" },
      { value: fmt(inspections.count ?? 0), label: "Inspeksi direview", href: "/ckb/inspections" },
    ];
  }

  return <CkbHome role={role} greet={pickGreeting(hour, user.name)} dateLine={dateLine} board={board} denied={sp.ditolak === "1"} />;
}
