import { getSessionUser } from "@/lib/auth";
import { Nav } from "@/components/app/nav";
import { WaveAlerts } from "@/components/app/wave-alerts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) throw new Error("Sesi situs tidak tersedia.");
  return (
    <div className="min-h-screen">
      <Nav role={user.role} />
      <div className="pb-20 lg:pb-0 lg:pl-56">{children}</div>
      <WaveAlerts />
    </div>
  );
}
