import { getSessionUser } from "@/lib/auth";
import { Nav } from "@/components/app/nav";
import { Suspense } from "react";
import { WaveAlerts } from "@/components/app/wave-alerts";
import { WelcomeScreen } from "@/components/app/welcome-screen";
import { SiteFooter } from "@/components/app/site-footer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) throw new Error("Sesi situs tidak tersedia.");
  return (
    <div className="min-h-screen">
      <Nav role={user.role} />
      <div className="pb-20 lg:pb-0 lg:pl-56">
        {children}
        <SiteFooter />
      </div>
      <WaveAlerts />
      {/* useSearchParams inside: its own Suspense boundary so it never holds up a page. */}
      <Suspense fallback={null}><WelcomeScreen /></Suspense>
    </div>
  );
}
