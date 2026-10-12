import { ListTodo, Route, Boxes, ClipboardCheck, Package, ClipboardList, PackageCheck, MapPin, ShieldCheck, LayoutDashboard, ListChecks, PackagePlus, Printer, ScanLine, Settings, Upload, History, SlidersHorizontal, Truck, Tags, Barcode, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/types";

/**
 * The app's navigation, in one place: the desktop sidebar, the phone bottom bar and the Home page's
 * module cards all read it, so a new module added here appears in all three.
 */
export type NavLink = { href: string; label: string; icon: LucideIcon; roles: Role[] };
const ALL: Role[] = ["operator", "supervisor", "admin"];
const SUP: Role[] = ["supervisor", "admin"];

/** Sidebar order: overview first, then by job. Empty sections are hidden per role. */
export const SECTIONS: { title: string | null; links: NavLink[] }[] = [
  { title: null, links: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: SUP },
  ] },
  { title: "Operasional", links: [
    { href: "/scan", label: "Scan", icon: ScanLine, roles: ALL },
    { href: "/receiving", label: "Penerimaan", icon: Truck, roles: ALL },
    { href: "/waves", label: "Wave", icon: ListChecks, roles: ALL },
    { href: "/allocate", label: "Alokasi", icon: ClipboardList, roles: SUP },
    { href: "/putaway", label: "Putaway", icon: PackagePlus, roles: SUP },
    { href: "/pickfaces", label: "Pickface", icon: MapPin, roles: SUP },
  ] },
  { title: "Stok", links: [
    { href: "/inventory", label: "Inventory", icon: Package, roles: ALL },
    { href: "/warehouse", label: "Gudang 3D", icon: Boxes, roles: ALL },
    { href: "/adjust", label: "Adjust stok", icon: SlidersHorizontal, roles: SUP },
    { href: "/movements", label: "Mutasi", icon: History, roles: SUP },
  ] },
  { title: "Kontrol", links: [
    { href: "/counts", label: "Cycle count", icon: ListTodo, roles: ALL },
    { href: "/audit/picking", label: "Audit picking", icon: PackageCheck, roles: ALL },
    { href: "/audit/putaway", label: "Audit putaway", icon: ClipboardCheck, roles: ALL },
    { href: "/data-quality", label: "Kualitas data", icon: ShieldCheck, roles: SUP },
    { href: "/trace", label: "Lacak batch", icon: Route, roles: SUP },
  ] },
  { title: "Admin", links: [
    { href: "/labels", label: "Label", icon: Printer, roles: SUP },
    { href: "/admin/items", label: "Master item", icon: Tags, roles: SUP },
    { href: "/admin/barcode", label: "Ikat barcode", icon: Barcode, roles: SUP },
    { href: "/admin/import", label: "Import", icon: Upload, roles: ["admin"] },
    { href: "/admin/settings", label: "Pengaturan", icon: Settings, roles: ["admin"] },
  ] },
];

/** Phone bottom bar: floor work first, at most five. */
export const MOBILE = ["/scan", "/waves", "/inventory", "/adjust", "/dashboard", "/warehouse"];


/** The sidebar's sections for a role; empty sections are dropped. */
export function sectionsFor(role: Role): { title: string | null; links: NavLink[] }[] {
  return SECTIONS.map((sec) => ({ ...sec, links: sec.links.filter((l) => l.roles.includes(role)) })).filter((sec) => sec.links.length > 0);
}

/** The phone bottom bar for a role: at most five. */
export function mobileLinksFor(role: Role): NavLink[] {
  const byHref = new Map(sectionsFor(role).flatMap((sec) => sec.links).map((l) => [l.href, l]));
  return MOBILE.map((h) => byHref.get(h)).filter((l): l is NavLink => !!l).slice(0, 5);
}

/** The Home page's main button: the dashboard, or Scan for operators (who cannot open the dashboard). */
export function homePrimary(role: Role): { href: string; label: string } {
  return role === "operator" ? { href: "/scan", label: "Buka Scan" } : { href: "/dashboard", label: "Buka dashboard" };
}
