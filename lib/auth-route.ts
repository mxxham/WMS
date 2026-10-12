/**
 * Where a request goes (middleware.ts): signed out -> /login?next=<page>, signed in on /login ->
 * back to that page. Pure, so the rule is tested without a server.
 */
export const PUBLIC_PATHS = ["/login", "/keluar"];

const isPublic = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** A same-site path to return to; anything else (other sites, protocol-relative, /login) is "/". */
export function safeNext(next: string | null): string {
  if (!next) return "/";
  let v = next;
  try { v = decodeURIComponent(next); } catch { return "/"; }
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.includes("\\")) return "/";
  if (v === "/login" || v.startsWith("/login?") || v.startsWith("/keluar")) return "/";
  return v;
}

export function authRedirect(path: string, search: string, signedIn: boolean): string | null {
  if (!signedIn) {
    if (isPublic(path)) return null;
    const here = path + search;
    return here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
  }
  if (path === "/login") return safeNext(new URLSearchParams(search).get("next"));
  return null;
}
