"use server";
import { revalidatePath } from "next/cache";
import { checkRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { PASSWORD_MIN, internalEmail, newUserError, normalizeUsername } from "@/lib/username";
import { loginRequired } from "@/lib/auth-route";

// Pengguna (spec §3). Passwords live in Supabase Auth, so creating accounts and setting passwords
// use the Auth admin API (service role) after an admin check; role and status go through the
// 0071 RPCs as the admin, which enforce "not yourself" and "one active admin".
const BAN = "876000h"; // ~100 years: Supabase's way to block sign-in

async function admin() {
  const u = await checkRole(["admin"]);
  if (!u) throw new Error("Hanya admin.");
  return u;
}
const done = () => { revalidatePath("/admin/users"); return null; };

/** True for the shared site account (app_metadata.shared, or the site-account email). */
export async function isSharedAccount(id: string): Promise<boolean> {
  const { data } = await createServiceClient().auth.admin.getUserById(id);
  const u = data.user;
  if (!u) return false;
  return u.app_metadata?.shared === true || (!!process.env.SITE_ACCOUNT_EMAIL && u.email?.toLowerCase() === process.env.SITE_ACCOUNT_EMAIL.toLowerCase());
}

/** While login is not required every floor device runs on the shared account: leave it alone. */
async function sharedGuard(id: string): Promise<string | null> {
  if (loginRequired() || !(await isSharedAccount(id))) return null;
  return "Ini akun bersama yang dipakai semua perangkat selama login belum diwajibkan. Peran, status dan kata sandinya baru bisa diubah setelah LOGIN_REQUIRED aktif.";
}

export async function createUser(i: { name: string; username: string; password: string; role: string }): Promise<string | null> {
  try {
    await admin();
    const bad = newUserError(i);
    if (bad) return bad;
    const username = normalizeUsername(i.username);
    const db = await createClient();
    const { data: taken } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return `Nama pengguna ${username} sudah dipakai.`;
    const { data, error } = await createServiceClient().auth.admin.createUser({
      email: internalEmail(username), password: i.password, email_confirm: true,
      // username in app metadata: only the server can set it (0071 reads it from there).
      user_metadata: { name: i.name.trim() }, app_metadata: { username },
    });
    if (error || !data.user) return error?.message ?? "Akun tidak bisa dibuat.";
    if (i.role !== "operator") {
      const { error: e2 } = await db.rpc("set_user_role", { p_user: data.user.id, p_role: i.role });
      if (e2) return `Akun dibuat sebagai operator; peran tidak bisa diubah: ${e2.message}`;
    }
    return done();
  } catch (e) { return (e as Error).message; }
}

export async function setRole(id: string, role: string): Promise<string | null> {
  try {
    await admin();
    const shared = await sharedGuard(id);
    if (shared) return shared;
    const { error } = await (await createClient()).rpc("set_user_role", { p_user: id, p_role: role });
    return error ? error.message : done();
  } catch (e) { return (e as Error).message; }
}

export async function setActive(id: string, active: boolean): Promise<string | null> {
  try {
    await admin();
    const shared = await sharedGuard(id);
    if (shared) return shared;
    const { error } = await (await createClient()).rpc("set_user_active", { p_user: id, p_active: active });
    if (error) return error.message;
    const { error: e2 } = await createServiceClient().auth.admin.updateUserById(id, { ban_duration: active ? "none" : BAN });
    return e2 ? `Status disimpan, tetapi blokir masuk gagal: ${e2.message}` : done();
  } catch (e) { return (e as Error).message; }
}

/** Also allowed on your own account (cutover: change gudang's password). */
export async function resetPassword(id: string, password: string): Promise<string | null> {
  try {
    await admin();
    const shared = await sharedGuard(id);
    if (shared) return shared;
    if (password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
    const { error } = await createServiceClient().auth.admin.updateUserById(id, { password });
    return error ? error.message : done();
  } catch (e) { return (e as Error).message; }
}
