import { UserCheck, ListTodo, Route, Boxes, ClipboardCheck, Package, ClipboardList, PackageCheck, MapPin, ShieldCheck, LayoutDashboard, ListChecks, PackagePlus, Printer, ScanLine, Settings, Upload, History, SlidersHorizontal, Truck, Tags, Barcode, Users, BookOpen, type LucideIcon } from "lucide-react";
import type { Job } from "@/lib/jobs";

/**
 * The app's navigation, in one place: the desktop sidebar, the phone bottom bar and the Home page's
 * module cards all read it, so a new module added here appears in all three.
 */
export type NavLink = { href: string; label: string; icon: LucideIcon; jobs: Job[] };
const AI: Job = "admin_inbound", AO: Job = "admin_outbound", CK: Job = "checker", IV: Job = "inventory", OP: Job = "operator", LD: Job = "leader", AD: Job = "admin";
const ALL_JOBS: Job[] = [AI, AO, CK, IV, OP, LD, AD];

/** Sidebar order: overview first, then by job. Empty sections are hidden per role. */
export const SECTIONS: { title: string | null; links: NavLink[] }[] = [
  { title: null, links: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, jobs: [AI, AO, IV, LD, AD] },
  ] },
  { title: "Operasional", links: [
    { href: "/scan", label: "Scan", icon: ScanLine, jobs: ALL_JOBS },
    { href: "/receiving", label: "Penerimaan", icon: Truck, jobs: [AI, CK, LD, AD] },
    { href: "/waves", label: "Wave", icon: ListChecks, jobs: [AO, CK, OP, LD, AD] },
    { href: "/assign", label: "Penugasan", icon: UserCheck, jobs: [IV, LD, AD] },
    { href: "/allocate", label: "Alokasi", icon: ClipboardList, jobs: [AO, LD, AD] },
    { href: "/putaway", label: "Putaway", icon: PackagePlus, jobs: [AI, LD, AD] },
    { href: "/pickfaces", label: "Pickface", icon: MapPin, jobs: [IV, LD, AD] },
  ] },
  { title: "Stok", links: [
    { href: "/inventory", label: "Inventory", icon: Package, jobs: ALL_JOBS },
    { href: "/warehouse", label: "Gudang 3D", icon: Boxes, jobs: [IV, OP, LD, AD] },
    { href: "/adjust", label: "Adjust stok", icon: SlidersHorizontal, jobs: [IV, LD, AD] },
    { href: "/movements", label: "Mutasi", icon: History, jobs: [AI, IV, LD, AD] },
    { href: "/ledger", label: "Buku stok", icon: BookOpen, jobs: [IV, LD, AD] },
  ] },
  { title: "Kontrol", links: [
    { href: "/counts", label: "Cycle count", icon: ListTodo, jobs: [IV, LD, AD] },
    { href: "/audit/picking", label: "Audit picking", icon: PackageCheck, jobs: [AO, CK, LD, AD] },
    { href: "/audit/putaway", label: "Audit putaway", icon: ClipboardCheck, jobs: [AI, CK, LD, AD] },
    { href: "/data-quality", label: "Kualitas data", icon: ShieldCheck, jobs: [IV, LD, AD] },
    { href: "/trace", label: "Lacak batch", icon: Route, jobs: [IV, LD, AD] },
  ] },
  { title: "Admin", links: [
    { href: "/labels", label: "Label", icon: Printer, jobs: [AI, LD, AD] },
    { href: "/labels/pallet", label: "Kartu palet", icon: Printer, jobs: [AI, LD, AD] },
    { href: "/admin/items", label: "Master item", icon: Tags, jobs: [AI, IV, LD, AD] },
    { href: "/admin/barcode", label: "Ikat barcode", icon: Barcode, jobs: [IV, LD, AD] },
    { href: "/admin/import", label: "Import", icon: Upload, jobs: [AD] },
    { href: "/admin/settings", label: "Pengaturan", icon: Settings, jobs: [AD] },
    { href: "/admin/users", label: "Pengguna", icon: Users, jobs: [AD] },
  ] },
];

/** Phone bottom bar: floor work first, at most five. */
export const MOBILE = ["/scan", "/waves", "/inventory", "/adjust", "/dashboard", "/warehouse"];


/** The sidebar's sections for a job; empty sections are dropped. */
export function sectionsFor(job: Job): { title: string | null; links: NavLink[] }[] {
  return SECTIONS.map((sec) => ({ ...sec, links: sec.links.filter((l) => l.jobs.includes(job)) })).filter((sec) => sec.links.length > 0);
}

/** The phone bottom bar for a job: at most five. */
export function mobileLinksFor(job: Job): NavLink[] {
  const byHref = new Map(sectionsFor(job).flatMap((sec) => sec.links).map((l) => [l.href, l]));
  return MOBILE.map((h) => byHref.get(h)).filter((l): l is NavLink => !!l).slice(0, 5);
}

/** The Home page's main button: the dashboard when the job may open it, otherwise Scan. */
export function homePrimary(job: Job): { href: string; label: string } {
  return pageAllowed(job, "/dashboard") ? { href: "/dashboard", label: "Buka dashboard" } : { href: "/scan", label: "Buka Scan" };
}

/** Pages every job may open. */
export const OPEN_PATHS = ["/home", "/lisensi", "/privasi"];

const LINKS: NavLink[] = SECTIONS.flatMap((sec) => sec.links);
const under = (path: string, href: string) => path === href || path.startsWith(href + "/");

/**
 * The single page gate. The longest link href that is the path or a parent of it decides, so
 * `/labels/pallet` is not governed by `/labels`; `/bin/...` follows Scan; `/audit` follows either
 * audit link; `/` only redirects. No match means closed.
 */
export function pageAllowed(job: Job, path: string): boolean {
  if (path === "/" || OPEN_PATHS.some((p) => under(path, p))) return true;
  if (under(path, "/bin")) return pageAllowed(job, "/scan");
  if (path === "/audit") return pageAllowed(job, "/audit/picking") || pageAllowed(job, "/audit/putaway");
  let best: NavLink | null = null;
  for (const l of LINKS) if (under(path, l.href) && (!best || l.href.length > best.href.length)) best = l;
  return best ? best.jobs.includes(job) : false;
}
