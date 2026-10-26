import { requireRole } from "@/lib/auth";
import { HomePage, type HomeStats } from "@/components/home/home-page";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { jakartaDate } from "@/lib/inventory-view";
import { pickGreeting } from "@/components/app/about-copy";

export const dynamic = "force-dynamic";

type Mv = { type: string; quantity: number; from_bin_id: string | null };
type Task = { status: string; task_type: string };

// Home (/home, opened from the logo): four cheap, warehouse-wide counters for the status strip, the
// same sources as the dashboard's "Operasi hari ini". The dashboard stays the command deck; here they
// are only a live pulse.
export default async function Home() {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const supabase = await createClient();
  const today = jakartaDate();
  const todayStart = new Date(`${today}T00:00:00+07:00`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23" }).format(new Date()).slice(0, 2));
  const greet = pickGreeting(hour, user.name);
  const [moves, tasks, waves] = await Promise.all([
    fetchAll<Mv>((a, b) => supabase.from("movements").select("type, quantity, from_bin_id").in("type", ["inbound", "putaway", "picking"]).gte("created_at", todayStart.toISOString()).order("id").range(a, b)),
    fetchAll<Task>((a, b) => supabase.from("pick_task_detail").select("status, task_type").eq("planned_date", today).order("id").range(a, b)),
    supabase.from("waves").select("status").eq("planned_date", today),
  ]);
  // Today's flow: in = new receipts (inbound, putaway without a source bin), out = picking.
  const flow = { masuk: 0, keluar: 0 };
  for (const m of moves) {
    if (m.type === "picking") flow.keluar += Number(m.quantity);
    else if (m.type === "inbound" || !m.from_bin_id) flow.masuk += Number(m.quantity);
  }
  const picks = tasks.filter((t) => t.task_type === "PICK" && t.status !== "CANCELLED");
  const todayWaves = waves.data ?? [];
  const stats: HomeStats = {
    masuk: flow.masuk,
    keluar: flow.keluar,
    waves: { total: todayWaves.length, done: todayWaves.filter((w) => w.status === "COMPLETED").length },
    picks: { total: picks.length, done: picks.filter((t) => t.status === "COMPLETED").length },
  };
  const dateLine = todayStart.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  return <HomePage role={user.role} greet={greet} dateLine={dateLine} date={today} stats={stats} />;
}
