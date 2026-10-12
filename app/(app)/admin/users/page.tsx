import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { loginRequired } from "@/lib/auth-route";
import { PageHeader } from "@/components/app/page-header";
import { UsersClient, type UserRow } from "./users-client";

export const dynamic = "force-dynamic";

/** Pengguna (admin): every account, its role and status; create, change role, reset, deactivate. */
export default async function UsersPage() {
  const me = await requireRole(["admin"]);
  const { data } = await (await createClient()).from("profiles").select("id, name, username, role, active").order("active", { ascending: false }).order("name");
  // The shared site account (app_metadata.shared): every floor device runs on it while login is off.
  const { data: auth } = await createServiceClient().auth.admin.listUsers({ perPage: 1000 });
  const siteEmail = process.env.SITE_ACCOUNT_EMAIL?.toLowerCase();
  const shared = (auth?.users ?? []).filter((u) => u.app_metadata?.shared === true || (!!siteEmail && u.email?.toLowerCase() === siteEmail)).map((u) => u.id);
  return (
    <main>
      <PageHeader title="Pengguna" />
      <div className="p-4 lg:p-8"><UsersClient rows={(data ?? []) as UserRow[]} me={me.id} shared={shared} locked={!loginRequired()} /></div>
    </main>
  );
}
