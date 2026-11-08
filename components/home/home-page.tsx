import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ABOUT } from "@/components/app/about-copy";
import { homePrimary, sectionsFor, type NavLink } from "@/components/app/nav-config";
import { Clock } from "@/components/app/clock";
import { FloorLine, FloorPhoto, TODAY_BOARD } from "@/components/floor/floor";
import { FloorDoorLink } from "@/components/floor/floor-door-link";
import { JOB_LABEL, type Job } from "@/lib/jobs";
import { BRAND } from "@/config/brand";
import { cn, fmtNum } from "@/lib/utils";

const FOCUS_NAVY = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-floor focus-visible:ring-offset-2 focus-visible:ring-offset-jeir-navy";
const FOCUS_PAPER = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb focus-visible:ring-offset-2";

/** Four warehouse-wide counts for the board, same sources as the dashboard's "Operasi hari ini". */
export type HomeStats = {
  masuk: number;
  keluar: number;
  waves: { total: number; done: number };
  picks: { total: number; done: number };
};

/**
 * Home (/home, opened from the logo), read like the warehouse floor (components/floor):
 * 1. the lobby: the floor in navy, the greeting, and one yellow floor line to this person's next step;
 * 2. today's board: the four counts the floor asks about first;
 * 3. the directory: every module the job opens, as aisle signs with one line on what each is for;
 * 4. who built it, in their own photo.
 */
export function HomePage({ job, greet, dateLine, date, stats }: {
  job: Job; greet: string; dateLine: string; date: string; stats: HomeStats;
}) {
  return (
    <main>
      <Lobby job={job} greet={greet} dateLine={dateLine} />
      <Board date={date} stats={stats} />
      <Directory job={job} />
      <Builders />
    </main>
  );
}

function Lobby({ job, greet, dateLine }: { job: Job; greet: string; dateLine: string }) {
  const primary = homePrimary(job);
  return (
    <section aria-labelledby="home-greeting" data-floor-stage className="relative isolate overflow-hidden bg-jeir-navy text-white">
      <FloorPhoto src={BRAND.floorPhoto} alt="" position="50% 62%" />
      {/* Darkest behind the words, opening up toward the racks on the right. */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-jeir-navy via-jeir-navy/80 to-jeir-navy/20" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-jeir-navy to-transparent" />

      <div className="relative px-4 pb-10 pt-8 sm:px-8 lg:px-12 lg:pb-14 lg:pt-12">
        <div className="flex items-center justify-between gap-4 text-sm text-white/70">
          <p>{dateLine}</p>
          <Clock className="text-white/70" />
        </div>

        <h1 id="home-greeting" className="mt-8 max-w-[22ch] text-balance font-cond text-[clamp(2rem,1.35rem+2.6vw,3.75rem)] font-bold leading-[1.02] tracking-[-0.02em] lg:mt-14">
          {greet}
        </h1>
        <p className="mt-4 max-w-prose text-white/70">
          {BRAND.appName}, {BRAND.site}. Masuk sebagai {JOB_LABEL[job]}.
        </p>

        {/* The floor line: from the greeting to this job's first stop. */}
        <div className="mt-10 flex items-center gap-1 lg:mt-14">
          <FloorLine className="max-w-[min(56rem,100%)]" />
          <Button asChild variant="floor" className={cn("floor-door h-14 shrink-0 px-6 text-lg", FOCUS_NAVY)}>
            <FloorDoorLink href={primary.href}>{primary.label}</FloorDoorLink>
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Today's counts as a departure-style board: big tabular numerals, the label under each, every one a link. */
function Board({ date, stats }: { date: string; stats: HomeStats }) {
  const items = [
    { value: fmtNum(stats.masuk), label: "Karton masuk hari ini", href: `/audit/putaway?date=${date}` },
    { value: fmtNum(stats.keluar), label: "Karton keluar hari ini", href: `/waves?date=${date}` },
    { value: `${fmtNum(stats.waves.done)}/${fmtNum(stats.waves.total)}`, label: "Wave selesai", href: `/waves?date=${date}` },
    { value: `${fmtNum(stats.picks.done)}/${fmtNum(stats.picks.total)}`, label: "Tugas pick selesai", href: `/waves?date=${date}` },
  ];
  return (
    // Opening the Dashboard from the button, this board grows into its "Hari ini" panel (FloorDoorLink).
    <section aria-labelledby="home-today" className="border-t border-white/10 bg-jeir-navy text-white" style={{ viewTransitionName: TODAY_BOARD }}>
      <h2 id="home-today" className="sr-only">Hari ini di gudang</h2>
      {/* 1px gaps over a lighter ground draw the dividers, whatever the column count. */}
      <ul className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
        {items.map((it) => (
          <li key={it.label} className="bg-jeir-navy">
            <Link href={it.href} className={cn("block px-4 py-5 transition-colors hover:bg-white/5 sm:px-8 lg:px-12", FOCUS_NAVY, "focus-visible:ring-inset")}>
              <span className="block font-cond text-[clamp(1.75rem,1.4rem+1.4vw,2.75rem)] font-bold leading-none tabular-nums">{it.value}</span>
              <span className="mt-2 block text-sm text-white/65">{it.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Every module the job opens, grouped as aisles: each group has a sign (the navy plate at the head of a
 * rack row) and its modules are rows with one line on what they are for. The job's first stop keeps the
 * floor line's end on its left edge, so the lobby's line visibly arrives here too.
 */
function Directory({ job }: { job: Job }) {
  const primary = homePrimary(job).href;
  return (
    <section aria-labelledby="home-modules-title" id="home-modules" className="scroll-mt-6 bg-paper px-4 pb-6 pt-12 sm:px-8 lg:px-12 lg:pt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="home-modules-title" className="font-cond text-3xl font-bold tracking-[-0.01em] text-steel">Semua modul</h2>
        <p className="text-sm text-steel-500">Yang bisa dibuka {JOB_LABEL[job]}</p>
      </div>
      {/* Balanced columns: groups of very different lengths (1 to 7 modules) settle without holes. */}
      <div className="mt-8 gap-x-10 xl:columns-2">
        {sectionsFor(job).map((sec) => (
          <div key={sec.title ?? "ringkasan"} className="mb-10 break-inside-avoid">
            <h3 className="inline-flex items-center gap-3 rounded-plate bg-jeir-navy px-3 py-1.5 font-cond text-lg font-bold text-white">
              {sec.title ?? "Ringkasan"}
              <span className="text-sm font-medium text-white/60 tabular-nums">{fmtNum(sec.links.length)}</span>
            </h3>
            <ul className="mt-3 divide-y divide-steel-100 rounded-lg bg-white ring-1 ring-steel-100">
              {sec.links.map((l) => <li key={l.href}><Row link={l} primary={l.href === primary} /></li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({ link: { href, label, blurb, icon: Icon }, primary }: { link: NavLink; primary: boolean }) {
  return (
    <Link href={href} className={cn("group relative flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-paper", FOCUS_PAPER, "focus-visible:ring-inset")}>
      {primary && <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-floor" />}
      <Icon aria-hidden className="h-5 w-5 shrink-0 text-ckb" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="font-semibold text-steel">{label}</span>
          {primary && <span className="text-xs font-semibold text-ckb-dark">Mulai di sini</span>}
        </span>
        <span className="block text-sm text-steel-500">{blurb}</span>
      </span>
      <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-steel-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ckb" />
    </Link>
  );
}

/** Who built it: the two of them in the warehouse, from their own welcome banner. */
function Builders() {
  return (
    <section aria-labelledby="home-credits" className="bg-paper px-4 pb-12 pt-6 sm:px-8 lg:px-12 lg:pb-16 lg:pt-10">
      <div className="grid overflow-hidden rounded-lg bg-jeir-navy text-white md:grid-cols-[18rem_minmax(0,1fr)] md:items-center lg:grid-cols-[20rem_minmax(0,1fr)_auto]">
        {/* A fixed square column: the photo is cropped to the two of them and never stretched wide. */}
        <div className="relative aspect-square w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.builders} alt={`${ABOUT.builders.map((b) => b.name).join(" dan ")} di lorong rak gudang CKB`}
            width={720} height={720} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="flex flex-col justify-center gap-3 px-6 py-8 md:px-10">
          <h2 id="home-credits" className="font-cond text-3xl font-bold leading-tight">
            {ABOUT.creditTitle}{" "}
            <span className="whitespace-nowrap">{ABOUT.builders.map((b) => b.name).join(" & ")}</span>
          </h2>
          <p className="max-w-prose text-white/70">{ABOUT.about} {ABOUT.copyright}.</p>
        </div>
        {/* The banner's lettering, back beside the people it was cut from: transparent, so it sits straight
            on the band's navy with no box around it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND.bannerLettering} alt={`Welcome to ${BRAND.appName}, Warehouse Management System`}
          width={560} height={500} loading="lazy" decoding="async"
          className="mr-10 hidden h-auto w-60 lg:block xl:w-64" />
      </div>
    </section>
  );
}
