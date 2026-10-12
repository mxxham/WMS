import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { UsersClient, type UserRow } from "./users-client";

export const dynamic = "force-dynamic";

/** Pengguna (admin): every account, its role and status; create, change role, reset, deactivate. */
export default async function UsersPage() {
  const me = await requireRole(["admin"]);
  const { data } = await (await createClient()).from("profiles").select("id, name, username, role, active").order("active", { ascending: false }).order("name");
  return (
    <main>
      <PageHeader title="Pengguna" />
      <div className="p-4 lg:p-8"><UsersClient rows={(data ?? []) as UserRow[]} me={me.id} /></div>
    </main>
  );
}
