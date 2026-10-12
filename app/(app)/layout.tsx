import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Nav } from "@/components/app/nav";
import { Suspense } from "react";
import { WaveAlerts } from "@/components/app/wave-alerts";
import { WelcomeScreen } from "@/components/app/welcome-screen";
import { SiteFooter } from "@/components/app/site-footer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // The middleware already sent requests without a session to /login: no user here means a valid
  // token for a deactivated (or missing) profile. Sign it out.
  if (!user) redirect("/keluar?nonaktif=1");
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
