"use server";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeUsername, usernameError } from "@/lib/username";
import { safeNext } from "@/lib/auth-route";

const FAILED = "Nama pengguna atau kata sandi salah.";
const LOCKED = "Terlalu banyak percobaan untuk nama pengguna ini. Coba lagi 15 menit lagi.";

/**
 * Sign in by username: resolve the account's auth email on the server, then sign in with it.
 * Supabase limits sign-ins per IP, but here every attempt comes from the server's IP, so a username
 * is locked for 15 minutes after 5 wrong passwords (login_allowed / login_result, 0071). Unknown
 * usernames are counted the same way, so the answers never reveal which usernames exist.
 */
export async function loginAction(_: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const username = normalizeUsername(String(fd.get("username") ?? ""));
  const password = String(fd.get("password") ?? "");
  if (usernameError(username) || password.length === 0) return { error: FAILED };
  const svc = createServiceClient();
  const { data: allowed } = await svc.rpc("login_allowed", { p_username: username });
  if (allowed === false) return { error: LOCKED };
  const { data: email } = await svc.rpc("account_email", { p_username: username });
  const ok = typeof email === "string" && !!email
    && !(await (await createClient()).auth.signInWithPassword({ email, password })).error;
  await svc.rpc("login_result", { p_username: username, p_ok: ok });
  if (!ok) return { error: FAILED };
  redirect(safeNext(String(fd.get("next") ?? "")));
}
