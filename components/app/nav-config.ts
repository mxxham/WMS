import { LayoutGrid, UserCheck, ListTodo, Route, Boxes, ClipboardCheck, Package, ClipboardList, PackageCheck, MapPin, ShieldCheck, LayoutDashboard, ListChecks, PackagePlus, Printer, ScanLine, Settings, Upload, History, SlidersHorizontal, Truck, Tags, Barcode, Users, BookOpen, BarChart3, type LucideIcon } from "lucide-react";
import type { Job } from "@/lib/jobs";

/**
 * The app's navigation, in one place: the desktop sidebar, the phone bottom bar and the Home page's
 * module cards all read it, so a new module added here appears in all three.
 */
/** `blurb`: one plain line on what the page is for, shown on Home's module directory. */
export type NavLink = { href: string; label: string; blurb: string; icon: LucideIcon; jobs: Job[] };
const AI: Job = "admin_inbound", AO: Job = "admin_outbound", CK: Job = "checker", IV: Job = "inventory", OP: Job = "operator", LD: Job = "leader", AD: Job = "admin";
const ALL_JOBS: Job[] = [AI, AO, CK, IV, OP, LD, AD];

/** Sidebar order: overview first, then by job. Empty sections are hidden per role. */
export const SECTIONS: { title: string | null; links: NavLink[] }[] = [
  { title: null, links: [
    { href: "/dashboard", label: "Dashboard", blurb: "Ringkasan stok, operasi hari ini dan akurasi.", icon: LayoutDashboard, jobs: [AI, AO, IV, LD, AD] },
  ] },
  { title: "Operasional", links: [
    { href: "/scan", label: "Scan", blurb: "Scan label rak untuk melihat dan memindah isi bin.", icon: ScanLine, jobs: ALL_JOBS },
    { href: "/receiving", label: "Penerimaan", blurb: "Terima truk, periksa palet, posting ke stok.", icon: Truck, jobs: [AI, CK, LD, AD] },
    { href: "/waves", label: "Wave", blurb: "Picklist per wave, posting pick, tutup wave.", icon: ListChecks, jobs: [AO, CK, OP, LD, AD] },
    { href: "/assign", label: "Penugasan", blurb: "Bagi shipment hari ini ke operator.", icon: UserCheck, jobs: [IV, LD, AD] },
    { href: "/allocate", label: "Alokasi", blurb: "Upload jadwal outbound, buat rencana pick FEFO.", icon: ClipboardList, jobs: [AO, LD, AD] },
    { href: "/putaway", label: "Putaway", blurb: "Upload data putaway dan posting ke bin.", icon: PackagePlus, jobs: [AI, LD, AD] },
    { href: "/pickfaces", label: "Pickface", blurb: "Atur bin pickface untuk tiap SKU.", icon: MapPin, jobs: [IV, LD, AD] },
  ] },
  { title: "Stok", links: [
    { href: "/inventory", label: "Inventory", blurb: "Stok per bin, SKU, batch dan expired.", icon: Package, jobs: ALL_JOBS },
    { href: "/warehouse", label: "Gudang 3D", blurb: "Denah rak 3D dengan isi tiap bin.", icon: Boxes, jobs: [IV, OP, LD, AD] },
    { href: "/racks", label: "Rak & Lokasi", blurb: "Denah rak, status bin, pinjam ke CKB, rak baru.", icon: LayoutGrid, jobs: [AI, AO, IV, LD, AD] },
    { href: "/adjust", label: "Adjust stok", blurb: "Koreksi stok dengan alasan dan persetujuan.", icon: SlidersHorizontal, jobs: [IV, LD, AD] },
    { href: "/movements", label: "Mutasi", blurb: "Riwayat semua mutasi stok.", icon: History, jobs: [AI, IV, LD, AD] },
    { href: "/ledger", label: "Buku stok", blurb: "Buku SAP dibanding buku WMS per hari.", icon: BookOpen, jobs: [IV, LD, AD] },
    { href: "/abc", label: "Kelas ABC", blurb: "Kelas A, B, C dari frekuensi picking bulanan.", icon: BarChart3, jobs: [AO, IV, LD, AD] },
  ] },
  { title: "Kontrol", links: [
    { href: "/counts", label: "Cycle count", blurb: "Jadwal dan hasil cycle count per bin.", icon: ListTodo, jobs: [IV, LD, AD] },
    { href: "/audit/picking", label: "Audit picking", blurb: "Cek hasil pick per baris dan per rak.", icon: PackageCheck, jobs: [AO, CK, LD, AD] },
    { href: "/audit/putaway", label: "Audit putaway", blurb: "Cek putaway yang sudah diposting.", icon: ClipboardCheck, jobs: [AI, CK, LD, AD] },
    { href: "/data-quality", label: "Kualitas data", blurb: "Data stok yang perlu diperbaiki.", icon: ShieldCheck, jobs: [IV, LD, AD] },
    { href: "/trace", label: "Lacak batch", blurb: "Lacak satu batch dari masuk sampai keluar.", icon: Route, jobs: [IV, LD, AD] },
  ] },
  { title: "Admin", links: [
    { href: "/labels", label: "Label", blurb: "Cetak label lokasi rak.", icon: Printer, jobs: [AI, LD, AD] },
    { href: "/labels/pallet", label: "Kartu palet", blurb: "Cetak kartu palet penerimaan.", icon: Printer, jobs: [AI, LD, AD] },
    { href: "/admin/items", label: "Master item", blurb: "Master SKU: UPP, umur simpan, barcode.", icon: Tags, jobs: [AI, IV, LD, AD] },
    { href: "/admin/barcode", label: "Ikat barcode", blurb: "Ikat barcode karton ke SKU.", icon: Barcode, jobs: [IV, LD, AD] },
    { href: "/admin/import", label: "Import", blurb: "Import snapshot stok dari file WMS.", icon: Upload, jobs: [AD] },
    { href: "/admin/settings", label: "Pengaturan", blurb: "Aturan inventory, layout rak, status bin.", icon: Settings, jobs: [AD] },
    { href: "/admin/users", label: "Pengguna", blurb: "Akun, pekerjaan dan akses pengguna.", icon: Users, jobs: [AD] },
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
