import Link from "next/link";
import { ArrowLeft, Inbox } from "lucide-react";
import { LiveRefresh, type LiveTable } from "@/components/app/live-refresh";
import { Clock } from "@/components/app/clock";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/ckb/stocktake";
import { CkbMark } from "./nav";

/** CKB page header: title, optional way back, actions. The phone gets the CKB mark as its way home. */
export function CkbHeader({ title, subtitle, back, live, children }: {
  title: string; subtitle?: React.ReactNode; back?: { href: string; label: string }; live?: LiveTable[]; children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      {back && (
        <Link href={back.href} className="mb-1 inline-flex min-h-8 items-center gap-1 text-sm text-ckb hover:underline">
          <ArrowLeft className="h-4 w-4" />{back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/ckb" aria-label="Dashboard CKB 3PL" className="rounded-md lg:hidden"><CkbMark className="h-9 w-9 text-xs" /></Link>
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <h1 className="truncate font-cond text-2xl font-semibold">{title}</h1>
              {live && <LiveRefresh tables={live} />}
            </div>
            {subtitle && <div className="text-sm text-steel-500">{subtitle}</div>}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          <Clock />
        </div>
      </div>
    </header>
  );
}

/** Page body padding, the same as Shell pages. */
export function CkbBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("space-y-6 p-4 pb-24 lg:p-8", className)}>{children}</div>;
}

const TONE: Record<Tone, string> = {
  neutral: "bg-steel-100 text-steel-700",
  info: "bg-ckb-tint text-ckb-dark",
  ok: "bg-ok text-white",
  warn: "bg-warn text-steel",
  bad: "bg-bad text-white",
  muted: "bg-paper text-steel-500 ring-1 ring-steel-100",
};
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold", TONE[tone], className)}>{children}</span>;
}

/** A number on the dashboard: real count, link to where it is worked. */
export function StatTile({ label, value, href, tone = "neutral", hint }: { label: string; value: number | string; href?: string; tone?: "neutral" | "warn" | "bad" | "ok"; hint?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-steel-500">{label}</div>
      <div className={cn("font-cond text-4xl font-semibold tabular", tone === "warn" && Number(value) > 0 && "text-warn", tone === "bad" && Number(value) > 0 && "text-bad", tone === "ok" && "text-ok")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-steel-500">{hint}</div>}
    </>
  );
  const cls = "block rounded-lg border border-steel-100 bg-white p-4";
  return href ? <Link href={href} className={cn(cls, "hover:bg-steel-100/50 hover:ring-1 hover:ring-ckb/30")}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-steel-300 bg-white px-6 py-10 text-center">
      <Inbox className="h-8 w-8 text-steel-300" aria-hidden="true" />
      <p className="mt-3 font-cond text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-steel-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A notice band: info for context, warn for something that limits what the page can promise. */
export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad"; title?: string; children: React.ReactNode }) {
  return (
    <div role={tone === "info" ? "note" : "alert"} className={cn("rounded-lg px-4 py-3 text-sm",
      tone === "info" && "bg-ckb-tint/50 text-steel-700", tone === "warn" && "bg-warn/15 text-steel", tone === "bad" && "bg-bad/10 text-bad")}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-0.5")}>{children}</div>
    </div>
  );
}

/** Label/value pairs for a record header. */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-steel-500">{k}</dt>
          <dd className="truncate font-medium">{v ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}
