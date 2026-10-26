/**
 * CKB 3PL roles and which pages each may open. Pure, so the matrix is tested without a server.
 *
 * This decides what the navigation shows and which page redirects; it is NOT the authorization
 * layer. Every read is filtered by RLS and every write is checked again inside its RPC
 * (supabase/migrations/0099-0107), so a page reachable by mistake still shows nothing it should not.
 */
export type CkbRole = "admin" | "supervisor" | "operator" | "customer";

export const CKB_ROLES: readonly CkbRole[] = ["admin", "supervisor", "operator", "customer"];

export const CKB_ROLE_LABEL: Record<CkbRole, string> = {
  admin: "Admin CKB",
  supervisor: "Supervisor",
  operator: "Operator",
  customer: "Perwakilan customer",
};

const STAFF: CkbRole[] = ["admin", "supervisor", "operator"];
const LEAD: CkbRole[] = ["admin", "supervisor"];
const ALL: CkbRole[] = [...STAFF, "customer"];

export function isCkbRole(v: unknown): v is CkbRole {
  return typeof v === "string" && (CKB_ROLES as readonly string[]).includes(v);
}
export const isStaff = (r: CkbRole | null | undefined): boolean => !!r && r !== "customer";
export const isLead = (r: CkbRole | null | undefined): boolean => r === "admin" || r === "supervisor";

/**
 * Route prefixes, most specific first. A path not listed under /ckb is refused (fail closed).
 * Representatives get read-only views of their customer's finished records.
 */
export const CKB_ROUTES: { prefix: string; roles: CkbRole[] }[] = [
  { prefix: "/ckb/stock-take/new", roles: LEAD },
  { prefix: "/ckb/stock-take/*/count", roles: STAFF },
  { prefix: "/ckb/stock-take/*/discrepancies", roles: LEAD },
  { prefix: "/ckb/stock-take/*/review", roles: LEAD },
  { prefix: "/ckb/stock-take/*/export", roles: LEAD },
  { prefix: "/ckb/stock-take", roles: ALL },
  { prefix: "/ckb/rebagging", roles: STAFF },
  { prefix: "/ckb/inspections/new", roles: STAFF },
  { prefix: "/ckb/inspections", roles: ALL },
  { prefix: "/ckb/inventory", roles: STAFF },
  { prefix: "/ckb/sap/import", roles: LEAD },
  { prefix: "/ckb/sap/compare", roles: LEAD },
  { prefix: "/ckb/sap/export", roles: LEAD },
  { prefix: "/ckb/reports", roles: [...LEAD, "customer"] },
  { prefix: "/ckb/photos", roles: ALL },
  { prefix: "/ckb/activity", roles: LEAD },
  { prefix: "/ckb/customers", roles: LEAD },
  { prefix: "/ckb/users", roles: ["admin"] },
  { prefix: "/ckb/settings", roles: ["admin"] },
  { prefix: "/ckb", roles: ALL },
];

function matches(prefix: string, path: string): boolean {
  const want = prefix.split("/");
  const have = path.split("?")[0].replace(/\/+$/, "").split("/");
  if (have.length < want.length) return false;
  if (prefix === "/ckb") return have.length === 2 && have[1] === "ckb";
  return want.every((seg, i) => seg === "*" ? have[i] !== "" : seg === have[i]);
}

/** May `role` open `path`? Unknown /ckb paths and a missing role are refused. */
export function canAccess(role: CkbRole | null | undefined, path: string): boolean {
  if (!role) return false;
  const rule = CKB_ROUTES.find((r) => matches(r.prefix, path));
  return !!rule && rule.roles.includes(role);
}

/** Navigation: groups and items in sidebar order. Icons are attached in components/ckb/nav-config.ts. */
export type CkbNavItem = { href: string; label: string; icon: string };
export const CKB_NAV: { title: string; items: CkbNavItem[] }[] = [
  { title: "Ringkasan", items: [
    { href: "/ckb", label: "Dashboard", icon: "dashboard" },
  ] },
  { title: "Operasional gudang", items: [
    { href: "/ckb/rebagging", label: "Rebagging", icon: "rebag" },
    { href: "/ckb/inspections", label: "Inspeksi kargo", icon: "inspect" },
    { href: "/ckb/stock-take", label: "Stock take & hitung ulang", icon: "count" },
  ] },
  { title: "Inventaris & integrasi", items: [
    { href: "/ckb/inventory", label: "Inventaris", icon: "inventory" },
    { href: "/ckb/sap/import", label: "Import SAP", icon: "import" },
    { href: "/ckb/sap/export", label: "Export SAP", icon: "export" },
  ] },
  { title: "Laporan & catatan", items: [
    { href: "/ckb/reports", label: "Laporan", icon: "reports" },
    { href: "/ckb/photos", label: "Arsip foto", icon: "photos" },
    { href: "/ckb/activity", label: "Log aktivitas", icon: "activity" },
  ] },
  { title: "Administrasi", items: [
    { href: "/ckb/customers", label: "Customer", icon: "customers" },
    { href: "/ckb/users", label: "Akses pengguna", icon: "users" },
    { href: "/ckb/settings", label: "Pengaturan", icon: "settings" },
  ] },
];

/** The navigation a role sees: only items it may open, empty groups dropped. */
export function navFor(role: CkbRole | null | undefined): { title: string; items: CkbNavItem[] }[] {
  return CKB_NAV
    .map((g) => ({ title: g.title, items: g.items.filter((i) => canAccess(role, i.href)) }))
    .filter((g) => g.items.length > 0);
}
