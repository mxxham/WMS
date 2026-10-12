import Link from "next/link";
import { LiveRefresh, type LiveTable } from "@/components/app/live-refresh";
import { BRAND } from "@/config/brand";

/** `live`: tables whose changes re-render this page (see LiveRefresh). */
export function PageHeader({ title, live, liveDebounceMs, children }: {
  title: string; live?: LiveTable[]; liveDebounceMs?: number; children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className="flex items-baseline gap-3">
        {/* Phones have no sidebar: the logo here is their way to Home. */}
        <Link href="/home" aria-label="Beranda" className="self-center rounded-md bg-ckb p-1 lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb focus-visible:ring-offset-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt="" width={28} height={28} className="h-7 w-7 rounded bg-white p-0.5" />
        </Link>
        <h1 className="font-cond text-2xl font-semibold">{title}</h1>
        {live && <LiveRefresh tables={live} debounceMs={liveDebounceMs} />}
      </div>
      {children}
    </header>
  );
}
