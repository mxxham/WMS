import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { CkbHeader, CkbBody, Notice } from "@/components/ckb/ui";
import { UsersClient, type CkbUserRow } from "./users-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Akses pengguna" };

/** CKB access: the CKB app, the CKB role and customer assignments — three separate things (0099). */
export default async function CkbUsersPage() {
  const me = await requireCkb("/ckb/users");
  const db = await createClient();
  const [profiles, { data: roles }, { data: members }, { data: customers }] = await Promise.all([
    fetchAll<{ id: string; name: string; username: string; active: boolean; apps: string[] }>((a, b) =>
      db.from("profiles").select("id, name, username, active, apps").order("name").order("id").range(a, b)),
    db.from("ckb_user_roles").select("user_id, role"),
    db.from("ckb_customer_members").select("user_id, customer_id"),
    db.from("ckb_customers").select("id, name, active").order("name"),
  ]);
  const role = new Map((roles ?? []).map((r) => [r.user_id, r.role]));
  const rows: CkbUserRow[] = profiles.map((p) => ({
    ...p, ckbRole: role.get(p.id) ?? null,
    customers: (members ?? []).filter((m) => m.user_id === p.id).map((m) => m.customer_id),
  }));
  return (
    <main>
      <CkbHeader title="Akses pengguna" subtitle="Aplikasi CKB, peran CKB dan customer yang boleh dilihat." />
      <CkbBody>
        <Notice title="Tiga hal terpisah">
          Akses aplikasi menentukan seseorang bisa membuka CKB 3PL. Peran menentukan apa yang boleh ia lakukan. Penugasan
          customer membatasi perwakilan customer ke data customernya sendiri; staf melihat semua customer. Akses Shell WMS
          tidak diatur di sini. Akun bersama gudang tidak bisa diberi peran CKB.
        </Notice>
        <UsersClient rows={rows} customers={customers ?? []} me={me.id} />
      </CkbBody>
    </main>
  );
}
