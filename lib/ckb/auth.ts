import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, requireAppAccess, type SessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canAccess, isCkbRole, type CkbRole } from "./permissions";

export type CkbUser = SessionUser & {
  /** CKB operational role (ckb_user_roles); null = has the app but no role yet */
  ckbRole: CkbRole | null;
  /** customers a representative is assigned to; empty for staff (they see every customer) */
  customerIds: string[];
  /** the database has no CKB tables yet (migrations 0099-0107 not applied) */
  schemaMissing?: boolean;
};

/** PostgREST / Postgres codes for "this table does not exist (yet)". */
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);
export type CkbMember = CkbUser & { ckbRole: CkbRole };

/**
 * The signed-in account with its CKB role, once per request. App access comes from the profile
 * (lib/auth.ts); the role and assignments are read under RLS (own row only).
 */
export const getCkbUser = cache(async (): Promise<CkbUser | null> => {
  const user = await getSessionUser();
  if (!user || !user.apps.includes("ckb_3pl")) return null;
  const supabase = await createClient();
  const [{ data: role, error }, { data: members }] = await Promise.all([
    supabase.from("ckb_user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("ckb_customer_members").select("customer_id").eq("user_id", user.id),
  ]);
  // Not migrated yet: say so on the page instead of a crash whose message production hides.
  if (error && MISSING_TABLE.has(error.code)) return { ...user, ckbRole: null, customerIds: [], schemaMissing: true };
  if (error) throw new Error(`Peran CKB tidak bisa dibaca: ${error.message}`);
  return {
    ...user,
    ckbRole: isCkbRole(role?.role) ? role.role : null,
    customerIds: (members ?? []).map((m) => m.customer_id as string),
  };
});

/**
 * Page gate: CKB app (else the user's own home), a CKB role (else the /ckb notice), and the route
 * matrix in permissions.ts (else back to the dashboard with a notice). Data access is still RLS.
 */
export async function requireCkb(path: string): Promise<CkbMember> {
  await requireAppAccess("ckb_3pl");
  const user = await getCkbUser();
  if (!user) redirect("/keluar?nonaktif=1");
  if (!user.ckbRole) redirect("/ckb");
  if (!canAccess(user.ckbRole, path)) redirect("/ckb?ditolak=1");
  return user as CkbMember;
}

/** Route-handler / server-action gate: the member when their role is in `roles`, else null. */
export async function checkCkb(roles: readonly CkbRole[]): Promise<CkbMember | null> {
  const user = await getCkbUser();
  if (!user?.ckbRole || !roles.includes(user.ckbRole)) return null;
  return user as CkbMember;
}
