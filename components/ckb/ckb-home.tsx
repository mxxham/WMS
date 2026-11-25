import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Clock } from "@/components/app/clock";
import { Builders } from "@/components/home/builders";
import { FloorLine, FloorPhoto } from "@/components/floor/floor";
import { FloorDoorLink } from "@/components/floor/floor-door-link";
import { CKB_FALLBACK_ICON, CKB_ICONS } from "@/components/ckb/icons";
import { CKB_BLURBS, ckbPrimary } from "@/components/ckb/home-copy";
import { CkbMark } from "@/components/ckb/nav";
import { Notice } from "@/components/ckb/ui";
import { CKB_ROLE_LABEL, navFor, type CkbRole } from "@/lib/ckb/permissions";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";

const FOCUS_NAVY = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-floor focus-visible:ring-offset-2 focus-visible:ring-offset-jeir-navy";
const FOCUS_PAPER = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb focus-visible:ring-offset-2";

/** One cell of the board: a figure, what it counts, where it leads. */
export type BoardItem = { value: string; label: string; href: string };

/**
 * CKB 3PL home (/ckb), the same floor language as the Shell home (components/home/home-page.tsx):
 * 1. the lobby: the floor in navy, the greeting and one yellow floor line to this role's first stop (the line comes in from the left,
 *    continuing the one that leaves the login page);
 * 2. today's board of four counts for the role;
 * 3. the directory: every page the role may open, as aisle signs with one line on what each is for;
 * 4. who built it.
 */
export function CkbHome({ role, greet, dateLine, board, denied }: { role: CkbRole; greet: string; dateLine: string; board: BoardItem[]; denied: boolean }) {
  return (
    <main>
      <Lobby role={role} greet={greet} dateLine={dateLine} denied={denied} />
      <Board items={board} />
      <Directory role={role} />
      <Builders />
    </main>
  );
}

function Lobby({ role, greet, dateLine, denied }: { role: CkbRole; greet: string; dateLine: string; denied: boolean }) {
  const primary = ckbPrimary(role);
  return (
    <section aria-labelledby="ckb-greeting" data-floor-stage className="relative isolate overflow-hidden bg-jeir-navy text-white">
      <FloorPhoto src={BRAND.floorPhoto} alt="" position="50% 62%" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-jeir-navy via-jeir-navy/80 to-jeir-navy/20" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-jeir-navy to-transparent" />

      <div className="relative px-4 pb-10 pt-8 sm:px-8 lg:px-12 lg:pb-14 lg:pt-12">
        <div className="flex items-center justify-between gap-4 text-sm text-white/70">
          <p className="flex items-center gap-3">
            <CkbMark className="h-10 w-10" />
            <span>{dateLine}</span>
          </p>
          <Clock className="text-white/70" />
        </div>

        {denied && <div className="mt-6 max-w-xl text-steel"><Notice tone="warn">Halaman itu tidak tersedia untuk peran Anda.</Notice></div>}

        <h1 id="ckb-greeting" className="mt-8 max-w-[22ch] text-balance font-cond text-[clamp(2rem,1.35rem+2.6vw,3.75rem)] font-bold leading-[1.02] tracking-[-0.02em] lg:mt-14">
          {greet}
        </h1>
        <p className="mt-4 max-w-prose text-white/70">
          CKB 3PL, Warehouse 5. Masuk sebagai {CKB_ROLE_LABEL[role]}.
        </p>

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

/** The role's four counts as a departure-style board: big tabular numerals, the label under each, every one a link. */
function Board({ items }: { items: BoardItem[] }) {
  return (
    <section aria-labelledby="ckb-today" className="border-t border-white/10 bg-jeir-navy text-white">
      <h2 id="ckb-today" className="sr-only">Hari ini di CKB 3PL</h2>
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

/** Every page the role opens, grouped as aisles; the role's first stop keeps the floor line's end on its left edge. */
function Directory({ role }: { role: CkbRole }) {
  const primary = ckbPrimary(role).href;
  const groups = navFor(role).map((g) => ({ ...g, items: g.items.filter((i) => i.href !== "/ckb") })).filter((g) => g.items.length > 0);
  return (
    <section aria-labelledby="ckb-modules-title" className="scroll-mt-6 bg-paper px-4 pb-6 pt-12 sm:px-8 lg:px-12 lg:pt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="ckb-modules-title" className="font-cond text-3xl font-bold tracking-[-0.01em] text-steel">Semua halaman</h2>
        <p className="text-sm text-steel-500">Yang bisa dibuka {CKB_ROLE_LABEL[role]}</p>
      </div>
      <div className="mt-8 gap-x-10 xl:columns-2">
        {groups.map((g) => (
          <div key={g.title} className="mb-10 break-inside-avoid">
            <h3 className="inline-flex items-center gap-3 rounded-plate bg-jeir-navy px-3 py-1.5 font-cond text-lg font-bold text-white">
              {g.title}
              <span className="text-sm font-medium text-white/60 tabular-nums">{g.items.length}</span>
            </h3>
            <ul className="mt-3 divide-y divide-steel-100 rounded-lg bg-white ring-1 ring-steel-100">
              {g.items.map((i) => {
                const Icon = CKB_ICONS[i.icon] ?? CKB_FALLBACK_ICON;
                const first = i.href === primary;
                return (
                  <li key={i.href}>
                    <Link href={i.href} className={cn("group relative flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-paper", FOCUS_PAPER, "focus-visible:ring-inset")}>
                      {first && <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-floor" />}
                      <Icon aria-hidden className="h-5 w-5 shrink-0 text-ckb" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="font-semibold text-steel">{i.label}</span>
                          {first && <span className="text-xs font-semibold text-ckb-dark">Mulai di sini</span>}
                        </span>
                        <span className="block text-sm text-steel-500">{CKB_BLURBS[i.href] ?? ""}</span>
                      </span>
                      <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-steel-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ckb" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
