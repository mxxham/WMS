"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { mobileLinksFor, sectionsFor } from "./nav-config";
import { AccountBox, AccountSwitch } from "./account";
import { BRAND } from "@/config/brand";

export function Nav({ role }: { role: Role }) {
  const path = usePathname();
  const sections = sectionsFor(role);
  const mobile = mobileLinksFor(role);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col bg-ckb bg-jeir-side text-white lg:flex">
        <Link href="/home" aria-label="Beranda" className="flex items-center gap-3 px-4 py-5">
          {/* The logo is its own navy tile. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt="" width={80} height={80} className="h-20 w-20 shrink-0 rounded-md" />
          <span className="leading-tight">
            <span className="block font-cond text-2xl font-bold">{BRAND.appName}</span>
            <span className="inline-block rounded-plate bg-plate px-1.5 font-cond text-xs font-bold text-steel">{BRAND.site}</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-3 overflow-y-auto px-2 pb-4">
          {sections.map((sec) => (
            <div key={sec.title ?? "top"} className="space-y-0.5">
              {sec.title && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">{sec.title}</div>}
              {sec.links.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm", path.startsWith(href) ? "bg-ckb-dark font-medium text-jeir-teal" : "text-white/85 hover:bg-ckb-dark")}>
                  <Icon className="h-4 w-4" />{label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <AccountBox />
        <AccountSwitch />
      </aside>
      {/* Mobile bottom bar: five floor-work links fit one thumb row */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ckb-dark bg-ckb bg-jeir-bar text-white lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {mobile.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", path.startsWith(href) ? "text-jeir-teal" : "text-white/70")}>
            <Icon className="h-5 w-5" />{label}
          </Link>
        ))}
      </nav>
    </>
  );
}
