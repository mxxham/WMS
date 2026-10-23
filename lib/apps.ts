/**
 * App routing constants and helpers. Pure functions, zero I/O.
 */

export type AppId = "shell_wms" | "ckb_3pl";

export const APP_IDS: readonly AppId[] = ["shell_wms", "ckb_3pl"] as const;

export const APP_LABEL: Record<AppId, string> = {
  shell_wms: "Shell WMS",
  ckb_3pl: "CKB 3PL",
};

/**
 * Cast an unknown array to AppId[], dedupe, drop unknown ids.
 */
export function normalizeApps(v: unknown): AppId[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<AppId>();
  const out: AppId[] = [];
  for (const x of v) {
    if (typeof x === "string") {
      const key = x.trim().toLowerCase() as AppId;
      if ((APP_IDS as readonly string[]).includes(key) && !seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

/**
 * Home path for a single app.
 */
export function appsHome(app: AppId): "/" | "/ckb" {
  return app === "shell_wms" ? "/" : "/ckb";
}

/**
 * Resolve the landing path given the user's apps and their stored default.
 *
 * - empty apps         -> "/akses"
 * - exactly one app    -> its home
 * - both apps:
 *     - defaultApp valid and in apps -> that app's home
 *     - defaultApp missing/stale     -> "/" (deterministic fallback; RPC normally prevents this)
 * - >2 apps (should not happen with the type) -> treat like deduped set, same rules
 */
export function resolveAppsHome(
  apps: AppId[],
  defaultApp: string | null
): "/" | "/ckb" | "/akses" {
  const uniq = normalizeApps(apps);
  if (uniq.length === 0) return "/akses";
  if (uniq.length === 1) return appsHome(uniq[0]);
  // Two or more apps (normally exactly two)
  if (defaultApp != null && uniq.includes(defaultApp as AppId)) {
    return appsHome(defaultApp as AppId);
  }
  // Stale or missing default -> deterministic fallback to shell_wms home
  return "/";
}