/**
 * The one-time welcome screen's rule (components/app/welcome-screen.tsx): shown once per browser,
 * on a normal page only. Floor screens (scanner, checker, print) are never covered; a visit that
 * starts on one waits for the next normal page.
 */

export const WELCOME_KEY = "welcomeSeen:v1";

/** Path prefixes of the floor screens: scan, the checker screens, cycle count, a scanned bin, printing. */
const FLOOR_PREFIXES = ["/scan", "/audit", "/counts", "/bin", "/labels"];

export function isFloorScreen(path: string, search: string): boolean {
  if (FLOOR_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  // The Wave page's picking screen (rack scan) lives in the address as &pick=1.
  return path === "/waves" && new URLSearchParams(search).get("pick") === "1";
}

/** `seen` is null when storage cannot be read: then never show it (it could not be dismissed for good). */
export function shouldShowWelcome({ enabled, seen, path, search }: { enabled: boolean; seen: boolean | null; path: string; search: string }): boolean {
  return enabled && seen === false && !isFloorScreen(path, search);
}
