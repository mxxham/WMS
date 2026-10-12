"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { mobileLinksFor, sectionsFor } from "./nav-config";
import { BRAND } from "@/config/brand";

export function Nav({ role }: { role: Role }) {
  const path = usePathname();
  const sections = sectionsFor(role);
  const mobile = mobileLinksFor(role);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col bg-ckb text-white lg:flex">
        <Link href="/home" aria-label="Beranda" className="flex items-center gap-3 px-4 py-5">
          {/* On a white tile: the logo's dark green K would vanish on the green sidebar. */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" width={36} height={36} className="h-9 w-9" />
          </span>
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
