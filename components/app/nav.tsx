"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListTodo, Route, Boxes, ClipboardCheck, Package, ClipboardList, PackageCheck, MapPin, ShieldCheck, LayoutDashboard, ListChecks, PackagePlus, Printer, ScanLine, Settings, Upload, History, SlidersHorizontal, Truck, Tags, Barcode, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

type NavLink = { href: string; label: string; icon: LucideIcon; roles: Role[] };
const ALL: Role[] = ["operator", "supervisor", "admin"];
const SUP: Role[] = ["supervisor", "admin"];

/** Sidebar order: overview first, then by job. Empty sections are hidden per role. */
const SECTIONS: { title: string | null; links: NavLink[] }[] = [
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
const MOBILE = ["/scan", "/waves", "/inventory", "/adjust", "/dashboard", "/warehouse"];

export function Nav({ role }: { role: Role }) {
  const path = usePathname();
  const sections = SECTIONS.map((sec) => ({ ...sec, links: sec.links.filter((l) => l.roles.includes(role)) })).filter((sec) => sec.links.length > 0);
  const byHref = new Map(sections.flatMap((sec) => sec.links).map((l) => [l.href, l]));
  const mobile = MOBILE.map((h) => byHref.get(h)).filter((l): l is NavLink => !!l).slice(0, 5);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col bg-ckb text-white lg:flex">
        <Link href="/" className="flex items-center gap-3 px-4 py-5">
          {/* On a white tile: the logo's dark green K would vanish on the green sidebar. */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/k-one-logo.png" alt="" width={36} height={36} className="h-9 w-9" />
          </span>
          <span className="leading-tight">
            <span className="block font-cond text-2xl font-bold">K-one</span>
            <span className="inline-block rounded-plate bg-plate px-1.5 font-cond text-xs font-bold text-steel">CKB · WSM SUB 2</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-3 overflow-y-auto px-2 pb-4">
          {sections.map((sec) => (
            <div key={sec.title ?? "top"} className="space-y-0.5">
              {sec.title && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">{sec.title}</div>}
              {sec.links.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm", path.startsWith(href) ? "bg-ckb-dark font-medium text-plate" : "text-white/85 hover:bg-ckb-dark")}>
                  <Icon className="h-4 w-4" />{label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {/* Mobile bottom bar: five floor-work links fit one thumb row */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ckb-dark bg-ckb text-white lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {mobile.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", path.startsWith(href) ? "text-plate" : "text-white/70")}>
            <Icon className="h-5 w-5" />{label}
          </Link>
        ))}
      </nav>
    </>
  );
}
