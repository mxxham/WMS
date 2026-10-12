/**
 * Usernames (spec 2026-10-12 login §1): people sign in with a username, Supabase Auth with an email.
 * New accounts get a hidden internal email; sign-in resolves a username to whatever email the
 * account has (account_email(), 0071), so older accounts keep theirs.
 */
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const INTERNAL_DOMAIN = "pengguna.internal";

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameError(u: string): string | null {
  if (u.length < 3) return "Nama pengguna minimal 3 karakter.";
  if (u.length > 32) return "Nama pengguna maksimal 32 karakter.";
  if (!USERNAME_RE.test(u)) return "Nama pengguna hanya huruf kecil, angka, titik, garis bawah atau tanda hubung, tanpa spasi.";
  return null;
}

export function internalEmail(u: string): string {
  return `${u}@${INTERNAL_DOMAIN}`;
}
