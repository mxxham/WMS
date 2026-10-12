/**
 * Where a request goes (middleware.ts), with login required or not (LOGIN_REQUIRED). Pure, so the
 * rule is tested without a server.
 */
export const PUBLIC_PATHS = ["/login", "/keluar"];

const isPublic = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** A same-site path to return to; anything else (other sites, protocol-relative, /login) is "/". */
export function safeNext(next: string | null): string {
  if (!next) return "/";
  let v: string;
  try { v = decodeURIComponent(next); } catch { return "/"; }
  // Browsers drop tabs and newlines and read "\" as "/" ("/<tab>/evil.com" becomes "//evil.com"):
  // refuse all of them, then parse it the way a browser would and keep it only if it stays here.
  if (/[\u0000-\u001f\u007f\s\\]/.test(v) || !v.startsWith("/") || v.startsWith("//")) return "/";
  const here = "http://same.site";
  const u = new URL(v, here);
  if (u.origin !== here) return "/";
  const path = u.pathname + u.search + u.hash;
  if (path === "/login" || path.startsWith("/login?") || path.startsWith("/keluar")) return "/";
  return path;
}

/** Login on or off (spec revision): off keeps today's shared site account, with optional sign-in. */
export function loginRequired(): boolean {
  return process.env.LOGIN_REQUIRED === "true";
}

export type AuthRoute = { kind: "continue" } | { kind: "redirect"; to: string } | { kind: "shared" };
const go = (to: string): AuthRoute => ({ kind: "redirect", to });
const stay: AuthRoute = { kind: "continue" };

/**
 * required: signed out -> /login?next=<page>; signed in on /login -> back to that page.
 * not required: signed out -> "shared" (the middleware signs in as the site account, as before);
 * /login and /keluar always reachable, so anyone can sign in as their own account.
 */
export function authRoute(path: string, search: string, signedIn: boolean, required: boolean): AuthRoute {
  if (!required) return signedIn || isPublic(path) ? stay : { kind: "shared" };
  if (!signedIn) {
    if (isPublic(path)) return stay;
    const here = path + search;
    return go(here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`);
  }
  if (path === "/login") return go(safeNext(new URLSearchParams(search).get("next")));
  return stay;
}
