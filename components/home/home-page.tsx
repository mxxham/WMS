import type { CSSProperties } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ABOUT } from "@/components/app/about-copy";
import { homePrimary, sectionsFor, type NavLink } from "@/components/app/nav-config";
import { Clock } from "@/components/app/clock";
import type { Role } from "@/lib/types";
import { BRAND } from "@/config/brand";
import { cn, fmtNum } from "@/lib/utils";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb focus-visible:ring-offset-2";
/** Stagger for the entrance animation (globals.css `.home-rise` reads --d). */
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/** Four warehouse-wide counts for the status strip, same sources as the dashboard's "Operasi hari ini". */
export type HomeStats = {
  masuk: number;
  keluar: number;
  waves: { total: number; done: number };
  picks: { total: number; done: number };
};

/**
 * Home (/home, opened from the logo): the welcome banner runs edge to edge (no card), a navy status
 * strip continues the image's own right panel — greeting, today's pulse and the way in — then every
 * module the role can open, and who built the system.
 */
export function HomePage({ role, greet, dateLine, date, stats }: {
  role: Role; greet: string; dateLine: string; date: string; stats: HomeStats;
}) {
  return (
    <main>
      <Hero role={role} greet={greet} dateLine={dateLine} date={date} stats={stats} />
      <div className="px-4 pb-10 lg:px-10">
        <Modules role={role} />
        <Credits />
      </div>
    </main>
  );
}

/**
 * The banner image carries the name and "Welcome to" itself, so the heading is for screen readers
 * only. Its right panel is open navy, so the strip under it (`bg-jeir-side`, the sidebar gradient)
 * reads as the image simply continuing: first row greeting and CTAs, second row today's pulse.
 */
function Hero({ role, greet, dateLine, date, stats }: {
  role: Role; greet: string; dateLine: string; date: string; stats: HomeStats;
}) {
  const primary = homePrimary(role);
  const buttons = (cls: string) => (
    <>
      <Button asChild variant="accent" className={cn(cls, FOCUS, "focus-visible:ring-offset-jeir-navy")} style={delay(500)}>
        <Link href={primary.href}>{primary.label}<ChevronRight aria-hidden className="h-[1.1em] w-[1.1em]" /></Link>
      </Button>
      <a href="#home-modules" style={delay(650)}
        className={cn(FOCUS, "focus-visible:ring-offset-jeir-navy", "inline-flex items-center justify-center rounded-md bg-white font-semibold text-jeir-navy shadow-sm transition-colors hover:bg-ckb-tint", cls)}>
        {ABOUT.modulesButton}
      </a>
    </>
  );
  return (
    <section aria-labelledby="home-title" className="home-shine relative overflow-hidden bg-jeir-navy text-white">
      <h1 id="home-title" className="sr-only">{ABOUT.name}</h1>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND.banner} alt={`Dua pekerja gudang CKB menyambut di lorong rak; tulisan: Welcome to ${BRAND.appName}, Warehouse Management System`}
          width={1600} height={900} className="home-banner-in block aspect-video w-full object-cover" />
        {/* The image's own bottom eases into the strip: navy rises from the bottom edge. */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[22%] bg-gradient-to-t from-jeir-navy via-jeir-navy/30 to-transparent" />
      </div>
      {/* Darkest at the sidebar's edge, easing brighter rightward into the banner's own field. */}
      <div className="relative home-strip">
        <div className="flex flex-col gap-5 px-4 pb-4 pt-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-10">
          <div className="home-rise min-w-0" style={delay(200)}>
            {/* The greeting IS the whole line now (about-copy.ts carries the name inside it). */}
            <p className="font-cond text-2xl font-semibold tracking-tight lg:text-3xl">{greet}</p>
            <p className="mt-1 text-sm text-white/60">{dateLine}</p>
          </div>
          <div className="home-rise flex flex-wrap items-center gap-3" style={delay(350)}>
            {/* The same warehouse clock every page's header carries, tinted for the navy strip. */}
            <Clock className="text-white/70" />
            {buttons("h-12 px-6 text-base")}
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-4 sm:grid-cols-4 lg:px-10">
            <Stat label="Karton masuk hari ini" value={fmtNum(stats.masuk)} href={`/audit/putaway?date=${date}`} />
            <Stat label="Karton keluar hari ini" value={fmtNum(stats.keluar)} href={`/waves?date=${date}`} />
            <Stat label="Wave selesai" value={`${fmtNum(stats.waves.done)}/${fmtNum(stats.waves.total)}`} href={`/waves?date=${date}`} />
            <Stat label="Tugas pick selesai" value={`${fmtNum(stats.picks.done)}/${fmtNum(stats.picks.total)}`} href={`/waves?date=${date}`} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className={cn(FOCUS, "-mx-2 rounded-md px-2 py-1.5 transition hover:bg-white/10")}>
      <span className="block font-cond text-2xl font-semibold tabular">{value}</span>
      <span className="block text-xs text-white/60">{label}</span>
    </Link>
  );
}

function Modules({ role }: { role: Role }) {
  const primary = homePrimary(role).href;
  let i = 0;
  return (
    <section aria-labelledby="home-modules-title" id="home-modules" className="relative scroll-mt-6 space-y-6 pt-10">
      <span aria-hidden className="home-dots pointer-events-none absolute right-0 top-0 hidden h-28 w-56 lg:block" />
      <h2 id="home-modules-title" className="font-cond text-2xl font-semibold">{ABOUT.modulesTitle}</h2>
      {sectionsFor(role).map((sec) => (
        <div key={sec.title ?? "top"} className="space-y-2">
          {sec.title && <h3 className="text-xs font-semibold uppercase tracking-wide text-steel-500">{sec.title}</h3>}
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {sec.links.map((l) => (
              <li key={l.href} className="home-rise" style={delay(Math.min(i++ * 40, 600))}>
                <ModuleCard link={l} primary={l.href === primary} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ModuleCard({ link: { href, label, icon: Icon }, primary }: { link: NavLink; primary?: boolean }) {
  return (
    <Link href={href}
      className={cn("group relative flex min-h-20 items-center gap-3.5 rounded-xl bg-white p-4 font-medium text-steel transition hover:-translate-y-0.5 hover:shadow-md",
        primary ? "ring-1 ring-ckb" : "ring-1 ring-steel-100", FOCUS)}>
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark transition-colors group-hover:bg-ckb group-hover:text-white">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {primary && <span className="absolute right-3 top-2 text-[11px] font-semibold leading-4 text-ckb">Mulai di sini</span>}
      <ChevronRight aria-hidden className="ml-auto h-4 w-4 shrink-0 text-steel-300 transition group-hover:translate-x-0.5 group-hover:text-ckb" />
    </Link>
  );
}

/** Who built it: a slim navy strip at the end, in the sidebar's gradient. */
function Credits() {
  return (
    <section aria-labelledby="home-credits" className="mt-8 flex flex-col gap-4 rounded-2xl bg-jeir-navy bg-jeir-bar px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
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
