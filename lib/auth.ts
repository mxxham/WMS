import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export type SessionUser = {
  id: string; email: string | null; name: string; role: Role; username: string;
  /** the shared site account (app_metadata.shared, 0072), not a personal account */
  shared: boolean;
};

// cache(): the layout and the page both ask for the user; one request does
// the JWT check and profile read once. A deactivated account (0071) counts as signed out.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  const { data: profile, error } = await supabase.from("profiles").select("name, role, username, active").eq("id", claims.sub).single();
  // Deactivated: refused before the request (PT403, 0071), no readable row (PGRST116) or active=false.
  // Any other failure (network, timeout) is an error page with retry, never a sign-out.
  if (error && error.code !== "PT403" && error.code !== "PGRST116") throw new Error(`Profil tidak bisa dibaca: ${error.message}`);
  if (!profile || !profile.active) return null;
  const shared = (claims.app_metadata as { shared?: boolean } | undefined)?.shared === true
    || (!!process.env.SITE_ACCOUNT_EMAIL && email?.toLowerCase() === process.env.SITE_ACCOUNT_EMAIL.toLowerCase());
  return { id: claims.sub, email, name: profile.name ?? email ?? "User", role: profile.role as Role, username: profile.username, shared };
});

/** Sends to / when the site session's role is not allowed. */
export async function requireRole(allowed: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/keluar?nonaktif=1");
  if (!allowed.includes(user.role)) redirect("/?denied=1");
  return user;
}

/** Same check for route handlers: returns null instead of redirecting. */
export async function checkRole(allowed: Role[]): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && allowed.includes(user.role) ? user : null;
}
