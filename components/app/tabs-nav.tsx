import Link from "next/link";
import { cn } from "@/lib/utils";

/** Page tabs as links (?tab=…), so every tab has its own URL and server data. */
export function TabsNav({ base, tabs, active }: { base: string; tabs: { key: string; label: string; badge?: number }[]; active: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-steel-100 bg-white px-4 lg:px-8" aria-label="Bagian halaman">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}?tab=${t.key}`} aria-current={t.key === active ? "page" : undefined}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2.5 text-sm", t.key === active ? "border-ckb font-semibold text-ckb" : "border-transparent text-steel-500 hover:text-steel")}>
          {t.label}
          {!!t.badge && <span className="ml-1.5 rounded-full bg-warn px-1.5 text-xs font-semibold text-white">{t.badge}</span>}
        </Link>
      ))}
    </nav>
  );
}
