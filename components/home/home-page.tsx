import type { CSSProperties } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ABOUT } from "@/components/app/about-copy";
import { homePrimary, sectionsFor, type NavLink } from "@/components/app/nav-config";
import type { Role } from "@/lib/types";
import { BRAND } from "@/config/brand";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jeir-teal focus-visible:ring-offset-2";
/** Stagger for the entrance animation (globals.css `.home-rise` reads --d). */
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/**
 * Home (/home, opened from the logo): the welcome banner with the way in, every module the role
 * can open, and who built the system. No live numbers: those belong on the dashboard.
 */
export function HomePage({ role }: { role: Role }) {
  return (
    <main className="mx-auto max-w-5xl space-y-10 p-4 pb-8 lg:p-10">
      <Hero role={role} />
      <Modules role={role} />
      <Credits />
    </main>
  );
}

/**
 * The welcome banner (BRAND.banner) carries the name and "Welcome to" itself, so the heading is for
 * screen readers only. From md up the buttons sit on the banner, in the open navy under "Warehouse
 * Management System" (`.home-actions`, sized in container units so they scale with the image); on a
 * phone the banner is too small for that and they sit in a navy band under it.
 */
function Hero({ role }: { role: Role }) {
  const primary = homePrimary(role);
  const buttons = (cls: string) => (
    <>
      <Button asChild variant="accent" className={`home-glow home-rise ${cls} ${FOCUS} focus-visible:ring-offset-jeir-navy`} style={delay(450)}>
        <Link href={primary.href}>{primary.label}<ChevronRight aria-hidden className="h-[1.1em] w-[1.1em]" /></Link>
      </Button>
      <a href="#home-modules" style={delay(600)}
        className={`home-rise inline-flex items-center justify-center rounded-md bg-white font-semibold text-jeir-navy shadow-sm transition-colors hover:bg-ckb-tint ${cls} ${FOCUS} focus-visible:ring-offset-jeir-navy`}>
        {ABOUT.modulesButton}
      </a>
    </>
  );
  return (
    <section aria-labelledby="home-title" className="home-hero home-shine relative overflow-hidden rounded-2xl bg-jeir-navy text-white shadow-lg shadow-jeir-navy/20">
      <h1 id="home-title" className="sr-only">{ABOUT.name}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BRAND.banner} alt={`Dua pekerja gudang CKB menyambut di lorong rak; tulisan: Welcome to ${BRAND.appName}, Warehouse Management System`}
        width={1600} height={900} className="home-banner-in block aspect-video w-full object-cover" />
      <div className="home-actions hidden gap-[1.2cqw] md:flex">{buttons("home-cta")}</div>
      <div className="space-y-4 px-5 py-5 md:hidden">
        <p className="home-rise text-white/80" style={delay(300)}>{ABOUT.about}</p>
        <div className="grid gap-3">{buttons("h-12 text-base")}</div>
      </div>
    </section>
  );
}

function Modules({ role }: { role: Role }) {
  let i = 0;
  return (
    <section aria-labelledby="home-modules-title" id="home-modules" className="scroll-mt-6 space-y-6">
      <h2 id="home-modules-title" className="font-cond text-2xl font-semibold">{ABOUT.modulesTitle}</h2>
      {sectionsFor(role).map((sec) => (
        <div key={sec.title ?? "top"} className="space-y-2">
          {sec.title && <h3 className="text-xs font-semibold uppercase tracking-wide text-steel-500">{sec.title}</h3>}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sec.links.map((l) => <li key={l.href} className="home-rise" style={delay(Math.min(i++ * 40, 600))}><ModuleCard link={l} /></li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ModuleCard({ link: { href, label, icon: Icon } }: { link: NavLink }) {
  return (
    <Link href={href}
      className={`group flex min-h-16 items-center gap-3 rounded-xl bg-white p-3 font-medium text-steel ring-1 ring-steel-100 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-jeir-teal ${FOCUS}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-jeir-navy bg-jeir-bar text-jeir-teal">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      {label}
      <ChevronRight aria-hidden className="ml-auto h-4 w-4 text-steel-300 transition group-hover:translate-x-0.5 group-hover:text-ckb" />
    </Link>
  );
}

/** Who built it: a slim navy strip at the end, in the sidebar's gradient. */
function Credits() {
  return (
    <section aria-labelledby="home-credits" className="flex flex-col gap-4 rounded-2xl bg-jeir-navy bg-jeir-bar px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 id="home-credits" className="font-cond text-lg font-semibold text-jeir-teal">{ABOUT.creditTitle}</h2>
        <p className="text-sm text-white/70">{ABOUT.about}</p>
      </div>
      <ul className="flex flex-wrap gap-5">
        {ABOUT.builders.map((b) => (
          <li key={b.name} className="flex items-center gap-3">
            {b.photo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={b.photo} alt={b.name} width={44} height={44} className="h-11 w-11 rounded-full object-cover ring-2 ring-jeir-teal/60" />
              : <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full bg-jeir-teal font-cond text-xl font-bold text-jeir-navy">{b.name.charAt(0)}</span>}
            <span className="text-lg font-medium">{b.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
