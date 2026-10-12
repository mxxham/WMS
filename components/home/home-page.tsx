import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ABOUT } from "@/components/app/about-copy";
import { homePrimary, sectionsFor, type NavLink } from "@/components/app/nav-config";
import type { Role } from "@/lib/types";
import { BRAND } from "@/config/brand";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb focus-visible:ring-offset-2";

/**
 * Home (/home, opened from the logo): who built the system and the way into every module the role
 * can open. No live numbers: those belong on the dashboard.
 */
export function HomePage({ role }: { role: Role }) {
  return (
    <main className="home-fade mx-auto max-w-5xl space-y-10 p-4 pb-8 lg:p-10">
      <Hero role={role} />
      <Credits />
      <Modules role={role} />
    </main>
  );
}

function Hero({ role }: { role: Role }) {
  const primary = homePrimary(role);
  return (
    <section aria-labelledby="home-title" className="rounded-xl bg-ckb px-6 py-8 text-white sm:px-10 sm:py-12">
      <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-white p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND.logo} alt={`Logo ${BRAND.appName}`} width={48} height={48} className="h-12 w-12" />
      </span>
      <h1 id="home-title" className="mt-6 font-cond text-4xl font-bold leading-tight sm:text-5xl">{ABOUT.name}</h1>
      <p className="mt-2 text-lg text-white/85">{ABOUT.welcome}</p>
      <p className="mt-1 text-white/75">{ABOUT.about}</p>
      <Button asChild variant="plate" className={`mt-8 h-12 px-6 text-base ${FOCUS} focus-visible:ring-offset-ckb`}>
        <Link href={primary.href}>{primary.label}</Link>
      </Button>
    </section>
  );
}

function Credits() {
  return (
    <section aria-labelledby="home-credits" className="space-y-4">
      <h2 id="home-credits" className="font-cond text-2xl font-semibold">{ABOUT.creditTitle}</h2>
      <ul className="flex flex-wrap gap-6">
        {ABOUT.builders.map((b) => (
          <li key={b.name} className="flex items-center gap-3">
            {b.photo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={b.photo} alt={b.name} width={48} height={48} className="h-12 w-12 rounded-full object-cover" />
              : <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-plate font-cond text-xl font-bold text-steel">{b.name.charAt(0)}</span>}
            <span className="text-lg font-medium">{b.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Modules({ role }: { role: Role }) {
  return (
    <section aria-labelledby="home-modules" className="space-y-6">
      <h2 id="home-modules" className="font-cond text-2xl font-semibold">{ABOUT.modulesTitle}</h2>
      {sectionsFor(role).map((sec) => (
        <div key={sec.title ?? "top"} className="space-y-2">
          {sec.title && <h3 className="text-sm font-semibold text-steel-500">{sec.title}</h3>}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {sec.links.map((l) => <li key={l.href}><ModuleCard link={l} /></li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ModuleCard({ link: { href, label, icon: Icon } }: { link: NavLink }) {
  return (
    <Link href={href} className={`flex min-h-14 items-center gap-3 rounded-lg bg-white px-4 py-3 font-medium text-steel hover:bg-ckb-tint ${FOCUS}`}>
      <Icon aria-hidden className="h-5 w-5 shrink-0 text-ckb" />{label}
    </Link>
  );
}
