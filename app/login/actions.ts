"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeUsername, usernameError } from "@/lib/username";
import { safeNext } from "@/lib/auth-route";

const FAILED = "Nama pengguna atau kata sandi salah.";
const LOCKED = "Terlalu banyak percobaan untuk nama pengguna ini. Coba lagi 15 menit lagi.";
const UNAVAILABLE = "Masuk sedang tidak bisa. Coba lagi sebentar lagi.";

/** The client's IP as the host reports it (Vercel sets x-forwarded-for); part of the limit's key. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Sign in by username: resolve the account's auth email on the server, then sign in with it.
 * Supabase limits sign-ins per IP, but here every attempt comes from the server's IP, so 0071 keeps
 * its own limit: a username + client IP locks for 15 minutes after 5 wrong passwords, a username
 * everywhere after 30 across IPs. Unknown usernames count the same way (nothing is revealed), and if
 * the limit cannot be checked, sign-in is refused rather than let through.
 */
export async function loginAction(_: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const username = normalizeUsername(String(fd.get("username") ?? ""));
  const password = String(fd.get("password") ?? "");
  if (usernameError(username) || password.length === 0) return { error: FAILED };
  const svc = createServiceClient();
  const ip = await clientIp();
  const { data: allowed, error: limitError } = await svc.rpc("login_allowed", { p_username: username, p_ip: ip });
  if (limitError) return { error: UNAVAILABLE };
  if (allowed !== true) return { error: LOCKED };
  const { data: email } = await svc.rpc("account_email", { p_username: username });
  const ok = typeof email === "string" && !!email
    && !(await (await createClient()).auth.signInWithPassword({ email, password })).error;
  await svc.rpc("login_result", { p_username: username, p_ip: ip, p_ok: ok });
  if (!ok) return { error: FAILED };
  redirect(safeNext(String(fd.get("next") ?? "")));
}
