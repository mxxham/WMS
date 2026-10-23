import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, requireAppAccess } from "@/lib/auth";
import { Nav } from "@/components/app/nav";
import { WaveAlerts } from "@/components/app/wave-alerts";
import { WelcomeScreen } from "@/components/app/welcome-screen";
import { SiteFooter } from "@/components/app/site-footer";
import { SessionProvider } from "@/components/app/session";
import { loginRequired } from "@/lib/auth-route";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // The middleware already sent requests without a session to /login: no user here means a valid
  // token for a deactivated (or missing) profile. Sign it out.
  if (!user) redirect("/keluar?nonaktif=1");
  // app-level gate: the (app) group is the Shell WMS; a CKB-only account is routed to /ckb,
  // an account with no app to /akses.
  await requireAppAccess("shell_wms");
  return (
    <SessionProvider user={{
      name: user.name, username: user.username, role: user.role, loginRequired: loginRequired(),
      shared: user.shared,
    }}>
      <div className="min-h-screen">
        <Nav role={user.role} />
        <div className="pb-20 lg:pb-0 lg:pl-72">
          {children}
          <SiteFooter />
        </div>
        <WaveAlerts />
        {/* useSearchParams inside: its own Suspense boundary so it never holds up a page. */}
        <Suspense fallback={null}><WelcomeScreen /></Suspense>
      </div>
    </SessionProvider>
  );
}
