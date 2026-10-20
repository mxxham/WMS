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

export const PASSWORD_MIN = 8;
export const ROLES = ["operator", "supervisor", "admin"] as const;

/** Tambah pengguna: the first problem with the form, or null. */
export function newUserError(i: { name: string; username: string; password: string; role: string }): string | null {
  if (i.name.trim().length < 2) return "Nama wajib diisi.";
  const u = usernameError(normalizeUsername(i.username));
  if (u) return u;
  if (i.password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (!(ROLES as readonly string[]).includes(i.role)) return "Peran tidak dikenal.";
  return null;
}
