"use server";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeUsername, usernameError } from "@/lib/username";
import { safeNext } from "@/lib/auth-route";

const FAILED = "Nama pengguna atau kata sandi salah.";

/** Sign in by username: resolve the account's auth email on the server, then sign in with it. */
export async function loginAction(_: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const username = normalizeUsername(String(fd.get("username") ?? ""));
  const password = String(fd.get("password") ?? "");
  const fail = { error: FAILED };
  if (usernameError(username) || password.length === 0) return fail;
  const { data: email } = await createServiceClient().rpc("account_email", { p_username: username });
  if (typeof email !== "string" || !email) return fail;
  const { error } = await (await createClient()).auth.signInWithPassword({ email, password });
  if (error) return fail;
  redirect(safeNext(String(fd.get("next") ?? "")));
}
