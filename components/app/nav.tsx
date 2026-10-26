"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { mobileLinksFor, sectionsFor } from "./nav-config";
import { AccountBox, AccountSwitch } from "./account";
import { BRAND } from "@/config/brand";

/**
 * The phone bar stops at five thumb stops, so the sixth item opens this sheet: every link the sidebar
 * has, grouped and role-gated exactly as on the desktop, one tap from any page.
 *
 * The sheet rises from behind the bar: the bar is lifted above it (`z-[60]`) instead of the sheet
 * stopping short of it, so the sheet's navy runs edge to edge into the bar with no seam to measure, and
 * the bar itself keeps working — tapping another tab while the sheet is open navigates and closes it.
 * The scroll area reserves the bar's height at its end, so the last row still clears it. The bar also
 * opts back into pointer events while open: Radix's scroll lock turns them off for the whole page.
 *
 * The one animation lives here rather than in globals.css (another lane owns that file): a short rise
 * with the login-rise curve. `prefers-reduced-motion` already kills every animation in globals.css's
 * base layer, so this needs no exception of its own.
 */
const SHEET_CSS = `@keyframes nav-sheet-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
.nav-sheet-rise{animation:nav-sheet-rise 240ms cubic-bezier(0.2,0.7,0.2,1) both}`;

/** The bar's height, plus the phone's home-indicator inset: what the sheet's list keeps clear at its end. */
const BAR_HEIGHT = "calc(3.5rem + env(safe-area-inset-bottom) + 0.5rem)";

/** Focus, on navy: the sidebar's plate-blue ring. Rows take it inset so the ring never moves them. */
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plate focus-visible:ring-offset-2 focus-visible:ring-offset-jeir-navy";
const ROW_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-plate focus-visible:bg-ckb-dark";

export function Nav({ role }: { role: Role }) {
  const path = usePathname();
  const sections = sectionsFor(role);
  const mobile = mobileLinksFor(role);
  const [moreOpen, setMoreOpen] = useState(false);

  // Any route change closes the sheet, including one nobody tapped here (back button, a deep link):
  // a menu left hanging over a page it did not open reads as a stuck screen.
  useEffect(() => { setMoreOpen(false); }, [path]);

  return (
    <>
      <style>{SHEET_CSS}</style>
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
        <nav className="sidebar-scroll flex-1 space-y-3 overflow-y-auto px-2 pb-4">
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

      {/* Mobile bottom bar: five floor-work links fit one thumb row, and Lainnya reaches all the rest. */}
      <D.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <nav className={cn("fixed inset-x-0 bottom-0 flex border-t border-ckb-dark bg-ckb bg-jeir-bar text-white lg:hidden", moreOpen ? "pointer-events-auto z-[60]" : "z-30")} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {mobile.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] min-[360px]:text-[11px]", path.startsWith(href) ? "text-jeir-teal" : "text-white/70")}>
              <Icon className="h-5 w-5" />{label}
            </Link>
          ))}
          {/* Lainnya is a state, never a page: it lights up while the sheet is open, and nothing else. */}
          <D.Trigger asChild>
            <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen}
              className={cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] min-[360px]:text-[11px]", moreOpen ? "text-jeir-teal" : "text-white/70")}>
              <Menu className="h-5 w-5" />Lainnya
            </button>
          </D.Trigger>
        </nav>

        <D.Portal>
          {/* The page dims behind the sheet; the bar rides above both, so it stays crisp and tappable. */}
          <D.Overlay className="animate-fade-in fixed inset-0 z-40 bg-jeir-navy/60 backdrop-blur-[2px]" />
          <D.Content aria-describedby={undefined}
            className="nav-sheet-rise fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-jeir-side text-white shadow-[0_-20px_60px_-16px_rgba(2,15,25,0.9)] ring-1 ring-white/15 focus:outline-none">
            {/* The sheet's top edge: the same thin water line as the welcome screen. */}
            <div aria-hidden="true" className="h-px shrink-0 bg-gradient-to-r from-transparent via-jeir-teal/60 to-transparent" />
            <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/25" />
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 pb-2 pl-5 pr-2 pt-1">
              <D.Title className="font-cond text-lg font-bold tracking-tight">Menu</D.Title>
              <D.Close aria-label="Tutup" className={cn("-mr-1 flex h-11 w-11 items-center justify-center rounded-md text-white/60 hover:bg-ckb-dark hover:text-white", RING)}>
                <X className="h-5 w-5" />
              </D.Close>
            </div>
            <nav className="sidebar-scroll flex-1 overflow-y-auto overscroll-contain px-2 pt-1" style={{ paddingBottom: BAR_HEIGHT }}>
              {sections.map((sec) => (
                <div key={sec.title ?? "top"} className="mt-1 space-y-0.5 first:mt-0">
                  {sec.title && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">{sec.title}</div>}
                  {sec.links.map(({ href, label, icon: Icon }) => {
                    const active = path.startsWith(href);
                    return (
                      <Link key={href} href={href} onClick={() => setMoreOpen(false)} aria-current={active ? "page" : undefined}
                        className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm", ROW_RING,
                          active ? "bg-ckb-dark font-medium text-jeir-teal" : "text-white/85 hover:bg-ckb-dark")}>
                        <Icon className={cn("h-5 w-5 shrink-0", active ? "text-jeir-teal" : "text-white/55")} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {active && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-jeir-teal" />}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}
