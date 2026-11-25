/**
 * Who is looking at which SKU of a reconciliation (migration 0155). A claim is soft: it is shown, nothing is blocked,
 * someone else can take over. The person is the typed name, since the shared site account is one login for everybody.
 */

/** A row of recon_claims_active. */
export type ReconClaim = { line_id: string; by_name: string; claimed_at: string; last_seen_at: string };

/** A claim not seen for this many minutes is free (mirrors recon_claims_active). */
export const CLAIM_TTL_MIN = 30;
/** How often an open SKU refreshes its claim. */
export const CLAIM_HEARTBEAT_MS = 120_000;

const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Same rule as same_person() in the database: case and spacing do not matter, a blank name is nobody. */
export const samePerson = (a: string | null | undefined, b: string | null | undefined) => norm(a) !== "" && norm(a) === norm(b);

/** Whether a claim belongs to somebody else than `person`. */
export const heldByOther = (c: ReconClaim | undefined, person: string) => !!c && !samePerson(c.by_name, person);

/** "baru saja" / "5 menit lalu" / "2 jam lalu". */
export function claimAge(iso: string, now: Date = new Date()): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} menit lalu`;
  return `${Math.floor(min / 60)} jam lalu`;
}

/** Is a claim still alive at `now`, by its last heartbeat? */
export function claimAlive(c: Pick<ReconClaim, "last_seen_at">, now: Date = new Date()): boolean {
  return now.getTime() - new Date(c.last_seen_at).getTime() < CLAIM_TTL_MIN * 60_000;
}
