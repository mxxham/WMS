"use server";
import { revalidatePath } from "next/cache";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { PASSWORD_MIN, internalEmail, newUserError, normalizeUsername } from "@/lib/username";
import { isCkbRole } from "@/lib/ckb/permissions";

// CKB user administration. Roles, customers and the CKB app go through the audited RPCs as the CKB
// admin (0099), which refuse the shared account, self-changes and losing the last CKB admin. The
// Auth admin API (service role) is used only for what Supabase Auth owns: creating an account and
// setting a password — and only for CKB-only accounts, so a CKB admin can never take over a Shell
// account through this page.

async function ckbAdmin() {
  const u = await checkCkb(["admin"]);
  if (!u) throw new Error("Hanya admin CKB.");
  return u;
}
const done = () => { revalidatePath("/ckb/users"); return null; };

/** A new CKB-only account: no Shell access, the CKB app, then its CKB role and customers. */
export async function createCkbUser(i: { name: string; username: string; password: string; role: string; customers: string[] }): Promise<string | null> {
  try {
    await ckbAdmin();
    if (!isCkbRole(i.role)) return "Peran CKB tidak dikenal.";
    const bad = newUserError({ ...i, role: "operator" });
    if (bad) return bad;
    if (i.role === "customer" && i.customers.length === 0) return "Perwakilan customer harus ditugaskan ke minimal satu customer.";
    const username = normalizeUsername(i.username);
    const db = await createClient();
    const { data: taken } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return `Nama pengguna ${username} sudah dipakai.`;
    const svc = createServiceClient();
    const { data, error } = await svc.auth.admin.createUser({
      email: internalEmail(username), password: i.password, email_confirm: true,
      user_metadata: { name: i.name.trim() }, app_metadata: { username },
    });
    if (error || !data.user) return error?.message ?? "Akun tidak bisa dibuat.";
    // A new profile starts with the Shell app (0080's default). Take it away before anything else, on
    // this one freshly created account only; the CKB app is then granted through the audited RPC.
    const { error: e1 } = await svc.from("profiles").update({ apps: [], default_app: null }).eq("id", data.user.id);
    if (e1) return `Akun dibuat, tetapi akses Shell tidak bisa dilepas: ${e1.message}. Cabut di Pengguna (Shell).`;
    const { error: e2 } = await db.rpc("ckb_set_app_access", { p_user: data.user.id, p_grant: true });
    if (e2) return `Akun dibuat tanpa aplikasi: ${e2.message}`;
    const { error: e3 } = await db.rpc("ckb_set_user_access", { p_user: data.user.id, p_role: i.role, p_customers: i.role === "customer" ? i.customers : [] });
    if (e3) return `Akun dibuat dengan akses CKB, tetapi peran belum diberikan: ${e3.message}`;
    return done();
  } catch (e) { return (e as Error).message; }
}

export async function setCkbAccess(id: string, role: string | null, customers: string[]): Promise<string | null> {
  try {
    await ckbAdmin();
    if (role !== null && !isCkbRole(role)) return "Peran CKB tidak dikenal.";
    const { error } = await (await createClient()).rpc("ckb_set_user_access", { p_user: id, p_role: role, p_customers: role === "customer" ? customers : [] });
    return error ? error.message : done();
  } catch (e) { return (e as Error).message; }
}

export async function setCkbApp(id: string, grant: boolean): Promise<string | null> {
  try {
    await ckbAdmin();
    const { error } = await (await createClient()).rpc("ckb_set_app_access", { p_user: id, p_grant: grant });
    return error ? error.message : done();
  } catch (e) { return (e as Error).message; }
}

/** Only for CKB-only accounts: a Shell account's password stays with the Shell admins. */
export async function resetCkbPassword(id: string, password: string): Promise<string | null> {
  try {
    const me = await ckbAdmin();
    if (id === me.id) return "Ubah kata sandi akun Anda sendiri lewat admin Shell.";
    if (password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
    const svc = createServiceClient();
    const { data: p } = await svc.from("profiles").select("apps").eq("id", id).single();
    const apps = (p?.apps ?? []) as string[];
    if (!apps.includes("ckb_3pl") || apps.includes("shell_wms")) return "Hanya akun khusus CKB yang kata sandinya bisa diatur di sini.";
    const { data: u } = await svc.auth.admin.getUserById(id);
    if (u.user?.app_metadata?.shared === true) return "Akun bersama tidak diatur di sini.";
    const { error } = await svc.auth.admin.updateUserById(id, { password });
    if (error) return error.message;
    const { error: e2 } = await (await createClient()).rpc("ckb_note_password_reset", { p_user: id });
    return e2 ? `Kata sandi diganti, tetapi tidak tercatat di log: ${e2.message}` : done();
  } catch (e) { return (e as Error).message; }
}
