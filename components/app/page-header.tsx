import Link from "next/link";
import { LiveRefresh, type LiveTable } from "@/components/app/live-refresh";
import { BRAND } from "@/config/brand";
import { AccountButton } from "./account";
import { Clock } from "./clock";

/** `live`: tables whose changes re-render this page (see LiveRefresh). */
export function PageHeader({ title, live, liveDebounceMs, children }: {
  title: string; live?: LiveTable[]; liveDebounceMs?: number; children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className="flex items-baseline gap-3">
        {/* Phones have no sidebar: the logo here is their way to Home. */}
        <Link href="/home" aria-label="Beranda" className="self-center rounded-md lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb focus-visible:ring-offset-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt="" width={36} height={36} className="h-9 w-9 rounded-md" />
        </Link>
        <h1 className="font-cond text-2xl font-semibold">{title}</h1>
        {live && <LiveRefresh tables={live} debounceMs={liveDebounceMs} />}
      </div>
      {children}
      {/* The clock and the account join into one right cluster; ml-auto keeps them pinned to the
          right edge even when the pair wraps onto its own row on a narrow phone. */}
      <div className="ml-auto flex items-center gap-3">
        <Clock />
        <AccountButton />
      </div>
    </header>
  );
}
