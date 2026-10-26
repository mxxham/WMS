import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAppAccess } from "@/lib/auth";
import { getCkbUser } from "@/lib/ckb/auth";
import { loginRequired } from "@/lib/auth-route";
import { CkbNav } from "@/components/ckb/nav";
import { NoRole } from "./no-role";

/** CKB 3PL app shell — outside the Shell WMS (app) route group; the root layout owns <html>/<body>. */
export const metadata: Metadata = { title: { default: "CKB 3PL", template: "%s · CKB 3PL" } };

export default async function CkbLayout({ children }: { children: React.ReactNode }) {
  // App access first (a Shell-only account goes to its own home, no app at all to /akses).
  await requireAppAccess("ckb_3pl");
  const user = await getCkbUser();
  if (!user) redirect("/keluar?nonaktif=1");

  // The Shell session context stays out of CKB: the rebagging person-name field then works as on
  // the shared account (typed, remembered on the device), exactly as before this layout existed.
  return (
    <div className="min-h-screen">
      <CkbNav role={user.ckbRole} name={user.name} username={user.username} loginRequired={loginRequired()} />
      <div className="pb-20 lg:pb-0 lg:pl-72">
        {/* An account with the app but no CKB role sees why, not an empty app. Pages also refuse on their own. */}
        {user.ckbRole ? children : <NoRole shellAdmin={user.role === "admin" && user.apps.includes("shell_wms")} shared={user.shared} name={user.name} schemaMissing={user.schemaMissing} />}
      </div>
    </div>
  );
}
