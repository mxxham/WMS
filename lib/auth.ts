import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export type SessionUser = { id: string; email: string | null; name: string; role: Role };

// cache(): the layout and the page both ask for the user; one request does
// the JWT check and profile read once.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  const { data: profile } = await supabase.from("profiles").select("name, role").eq("id", claims.sub).single();
  return { id: claims.sub, email, name: profile?.name ?? email ?? "User", role: (profile?.role ?? "operator") as Role };
});

/** Sends to / when the site session's role is not allowed. */
export async function requireRole(allowed: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Sesi situs tidak tersedia.");
  if (!allowed.includes(user.role)) redirect("/?denied=1");
  return user;
}

/** Same check for route handlers: returns null instead of redirecting. */
export async function checkRole(allowed: Role[]): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && allowed.includes(user.role) ? user : null;
}
