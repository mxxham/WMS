import { requirePage } from "@/lib/auth";
import { HomePage, type HomeStats } from "@/components/home/home-page";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { jakartaDate } from "@/lib/inventory-view";
import { flowOnDay, inflowFetchSince, INFLOW_SELECT, type InflowMove } from "@/lib/inbound-day";
import { pickGreeting } from "@/components/app/about-copy";

export const dynamic = "force-dynamic";

type Task = { status: string; task_type: string };

// Home (/home, opened from the logo): four cheap, warehouse-wide counters for the status strip, the
// same sources as the dashboard's "Operasi hari ini". The dashboard stays the command deck; here they
// are only a live pulse.
export default async function Home() {
  const user = await requirePage("/home");
  const supabase = await createClient();
  const today = jakartaDate();
  const todayStart = new Date(`${today}T00:00:00+07:00`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23" }).format(new Date()).slice(0, 2));
  const greet = pickGreeting(hour, user.name);
  const [moves, tasks, waves] = await Promise.all([
    // Karton masuk counts a putaway on its arrival date (posted up to 7 days later); picking on today.
    Promise.all([
      fetchAll<InflowMove>((a, b) => supabase.from("movements").select(INFLOW_SELECT).in("type", ["inbound", "putaway"]).gte("created_at", inflowFetchSince(today)).order("id").range(a, b)),
      fetchAll<InflowMove>((a, b) => supabase.from("movements").select(INFLOW_SELECT).eq("type", "picking").gte("created_at", todayStart.toISOString()).order("id").range(a, b)),
    ]).then(([inn, out]) => [...inn, ...out]),
    fetchAll<Task>((a, b) => supabase.from("pick_task_detail").select("status, task_type").eq("planned_date", today).order("id").range(a, b)),
    supabase.from("waves").select("status").eq("planned_date", today),
  ]);
  const flow = flowOnDay(moves, today);
  const picks = tasks.filter((t) => t.task_type === "PICK" && t.status !== "CANCELLED");
  const todayWaves = waves.data ?? [];
  const stats: HomeStats = {
    masuk: flow.masuk,
    keluar: flow.keluar,
    waves: { total: todayWaves.length, done: todayWaves.filter((w) => w.status === "COMPLETED").length },
    picks: { total: picks.length, done: picks.filter((t) => t.status === "COMPLETED").length },
  };
  const dateLine = todayStart.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  return <HomePage job={user.job} greet={greet} dateLine={dateLine} date={today} stats={stats} />;
}
