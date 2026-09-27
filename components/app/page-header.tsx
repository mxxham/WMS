import { LiveRefresh, type LiveTable } from "@/components/app/live-refresh";

/** `live`: tables whose changes re-render this page (see LiveRefresh). */
export function PageHeader({ title, live, liveDebounceMs, children }: {
  title: string; live?: LiveTable[]; liveDebounceMs?: number; children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className="flex items-baseline gap-3">
        <h1 className="font-cond text-2xl font-semibold">{title}</h1>
        {live && <LiveRefresh tables={live} debounceMs={liveDebounceMs} />}
      </div>
      {children}
    </header>
  );
}
