"use client";
import { useEffect, useState } from "react";

/** One warehouse, one time: the header's clock always shows Jakarta time (WIB) — the time the
 *  shifts, waves and FEFO dates already speak. Seconds appear from `sm` up; on a phone the compact
 *  hour keeps the last corner roomy for the account button. Digit shapes are language-neutral
 *  (en-GB renders the colons), which is why the format is not an id-ID string. */
const hms = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23", minute: "2-digit", second: "2-digit",
});

/** Ticks once a second, in its own little client island, so no page re-renders for it. The server
 *  ships an empty <time> and the first client paint also renders null — hydration agrees, then the
 *  effect fills the digits. `tabular-nums` keeps the width still as the digits rotate. */
export function Clock({ className = "text-steel-500" }: { className?: string }) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(hms.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time suppressHydrationWarning title="Waktu Jakarta (WIB)"
      className={`whitespace-nowrap font-cond text-sm font-medium tabular-nums tracking-wide ${className}`}>
      {now
        ? <>
          <span aria-hidden="true">{now.slice(0, 5)}</span><span aria-hidden="true" className="hidden sm:inline">{now.slice(5, 8)}</span>
          <span aria-hidden="true" className="ml-1 text-[0.85em] opacity-70">WIB</span>
          <span className="sr-only">Pukul {now} Waktu Indonesia Barat</span>
        </>
        : <span className="opacity-0" aria-hidden="true">--:--:-- WIB</span>}
    </time>
  );
}