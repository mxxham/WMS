import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";
import type { AppId } from "@/lib/apps";
import { normalizeApps, resolveAppsHome } from "@/lib/apps";

export type SessionUser = {
  id: string; email: string | null; name: string; role: Role; username: string;
  /** the shared site account (app_metadata.shared, 0072), not a personal account */
  shared: boolean;
  apps: AppId[];
  defaultApp: string | null;
};

// cache(): the layout and the page both ask for the user; one request does
// the JWT check and profile read once. A deactivated account (0071) counts as signed out.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  const { data: profile, error } = await supabase.from("profiles").select("name, role, username, active, apps, default_app").eq("id", claims.sub).single();
  // Deactivated: refused before the request (PT403, 0071), no readable row (PGRST116) or active=false.
  // Any other failure (network, timeout) is an error page with retry, never a sign-out.
  if (error && error.code !== "PT403" && error.code !== "PGRST116") throw new Error(`Profil tidak bisa dibaca: ${error.message}`);
  if (!profile || !profile.active) return null;
  const shared = (claims.app_metadata as { shared?: boolean } | undefined)?.shared === true
    || (!!process.env.SITE_ACCOUNT_EMAIL && email?.toLowerCase() === process.env.SITE_ACCOUNT_EMAIL.toLowerCase());
  return {
    id: claims.sub,
    email,
    name: profile.name ?? email ?? "User",
    role: profile.role as Role,
    username: profile.username,
    shared,
    apps: normalizeApps(profile.apps),
    defaultApp: profile.default_app ?? null,
  };
});

/** App-aware requireRole: first checks app access, then role. */
export async function requireRole(allowed: Role[], app: AppId = "shell_wms"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/keluar?nonaktif=1");
  if (!user.apps.includes(app)) {
    const home = resolveAppsHome(user.apps, user.defaultApp);
    redirect(home);
  }
  if (!allowed.includes(user.role)) redirect("/?denied=1");
  return user;
}

/** App-aware checkRole: first checks app access, then role. Returns null on any failure. */
export async function checkRole(allowed: Role[], app: AppId = "shell_wms"): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  if (!user.apps.includes(app)) return null;
  return allowed.includes(user.role) ? user : null;
}

/** Require access to a specific app. Redirects to the user's other app home or /akses on failure. */
export async function requireAppAccess(app: AppId): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/keluar?nonaktif=1");
  if (!user.apps.includes(app)) {
    const home = resolveAppsHome(user.apps, user.defaultApp);
    redirect(home);
  }
  return user;
}

/** Check access to a specific app. Returns null on failure (no user or no app access). */
export async function checkAppAccess(app: AppId): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  if (!user.apps.includes(app)) return null;
  return user;
}