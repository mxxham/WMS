"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import {
  Archive, Boxes, Building2, ChartColumn, ClipboardCheck, FileDown, FileUp, History, Images, LayoutDashboard,
  ListChecks, LogIn, LogOut, Menu, PackageOpen, Settings, Users, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { navFor, CKB_ROLE_LABEL, type CkbRole } from "@/lib/ckb/permissions";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, rebag: PackageOpen, inspect: ClipboardCheck, count: ListChecks, inventory: Boxes,
  import: FileUp, export: FileDown, reports: ChartColumn, photos: Images, activity: History, customers: Building2,
  users: Users, settings: Settings,
};
/** The phone bar's thumb stops, per role, in this order; everything else is under Lainnya. */
const PHONE: Record<CkbRole, string[]> = {
  admin: ["/ckb", "/ckb/stock-take", "/ckb/inspections", "/ckb/rebagging"],
  supervisor: ["/ckb", "/ckb/stock-take", "/ckb/inspections", "/ckb/rebagging"],
  operator: ["/ckb", "/ckb/stock-take", "/ckb/inspections", "/ckb/rebagging"],
  customer: ["/ckb", "/ckb/reports", "/ckb/photos", "/ckb/inspections"],
};
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plate focus-visible:ring-offset-2 focus-visible:ring-offset-jeir-navy";
const active = (path: string, href: string) => (href === "/ckb" ? path === "/ckb" : path === href || path.startsWith(`${href}/`));

/** The CKB 3PL mark: its own tile, never the Shell WMS logo. */
export function CkbMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-md bg-jeir-teal font-cond font-bold leading-none text-jeir-navy", className)}>
      3PL
    </span>
  );
}

function SignOut({ className }: { className?: string }) {
  return (
    <form action="/keluar" method="post">
      <button type="submit" className={className}><LogOut className="h-4 w-4" />Keluar</button>
    </form>
  );
}

/** CKB 3PL navigation: desktop sidebar, phone bottom bar with a Lainnya sheet (same shape as Shell's). */
export function CkbNav({ role, name, username, loginRequired }: { role: CkbRole | null; name: string; username: string; loginRequired: boolean }) {
  const path = usePathname();
  const groups = navFor(role);
  const all = groups.flatMap((g) => g.items);
  const phone = role ? PHONE[role].map((h) => all.find((i) => i.href === h)).filter((i): i is NonNullable<typeof i> => !!i) : [];
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);

  const links = (onClick?: () => void) => groups.map((g) => (
    <div key={g.title} className="space-y-0.5">
      <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">{g.title}</div>
      {g.items.map((i) => {
        const Icon = ICONS[i.icon] ?? Archive;
        const on = active(path, i.href);
        return (
          <Link key={i.href} href={i.href} onClick={onClick} aria-current={on ? "page" : undefined}
            className={cn("flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm", on ? "bg-ckb-dark font-medium text-jeir-teal" : "text-white/85 hover:bg-ckb-dark")}>
            <Icon className="h-4 w-4 shrink-0" /><span className="truncate">{i.label}</span>
          </Link>
        );
      })}
    </div>
  ));

  const account = (
    <div className="border-t border-white/10 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-xs text-white/60">{username}{role ? ` · ${CKB_ROLE_LABEL[role]}` : ""}</span>
        </span>
        <SignOut className={cn("inline-flex h-10 items-center gap-1 rounded-md px-2 text-white/85 hover:bg-ckb-dark", RING)} />
      </div>
      {!loginRequired && (
        <a href="/login" className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs text-white/70 underline-offset-2 hover:text-white hover:underline">
          <LogIn className="h-4 w-4" />Masuk sebagai akun lain
        </a>
      )}
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col bg-jeir-navy bg-jeir-side text-white lg:flex">
        <Link href="/ckb" aria-label="Dashboard CKB 3PL" className={cn("flex items-center gap-3 px-4 py-5", RING)}>
          <CkbMark className="h-14 w-14 text-xl" />
          <span className="leading-tight">
            <span className="block font-cond text-2xl font-bold">CKB 3PL</span>
            <span className="inline-block rounded-plate bg-plate px-1.5 font-cond text-xs font-bold text-steel">Warehouse 5</span>
          </span>
        </Link>
        <nav aria-label="Menu CKB" className="sidebar-scroll flex-1 space-y-2 overflow-y-auto px-2 pb-4">{links()}</nav>
        {account}
      </aside>

      {role && (
        <D.Root open={open} onOpenChange={setOpen}>
          <nav aria-label="Menu CKB ponsel" className={cn("fixed inset-x-0 bottom-0 flex border-t border-ckb-dark bg-jeir-navy bg-jeir-bar text-white lg:hidden", open ? "pointer-events-auto z-[60]" : "z-30")}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {phone.map((i) => {
              const Icon = ICONS[i.icon] ?? Archive;
              return (
                <Link key={i.href} href={i.href} className={cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] min-[360px]:text-[11px]", active(path, i.href) ? "text-jeir-teal" : "text-white/70")}>
                  <Icon className="h-5 w-5" /><span className="max-w-full truncate px-1">{i.label.split(" ")[0]}</span>
                </Link>
              );
            })}
            <D.Trigger asChild>
              <button type="button" aria-haspopup="dialog" aria-expanded={open}
                className={cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] min-[360px]:text-[11px]", open ? "text-jeir-teal" : "text-white/70")}>
                <Menu className="h-5 w-5" />Lainnya
              </button>
            </D.Trigger>
          </nav>
          <D.Portal>
            <D.Overlay className="animate-fade-in fixed inset-0 z-40 bg-jeir-navy/60 backdrop-blur-[2px]" />
            <D.Content aria-describedby={undefined}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-jeir-navy bg-jeir-side text-white ring-1 ring-white/15 focus:outline-none">
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 py-2 pl-5 pr-2">
                <D.Title className="font-cond text-lg font-bold">Menu CKB 3PL</D.Title>
                <D.Close aria-label="Tutup" className={cn("flex h-11 w-11 items-center justify-center rounded-md text-white/60 hover:bg-ckb-dark hover:text-white", RING)}>
                  <X className="h-5 w-5" />
                </D.Close>
              </div>
              <nav className="sidebar-scroll flex-1 overflow-y-auto overscroll-contain px-2" style={{ paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom) + 0.5rem)" }}>
                {links(() => setOpen(false))}
                {account}
              </nav>
            </D.Content>
          </D.Portal>
        </D.Root>
      )}
    </>
  );
}
