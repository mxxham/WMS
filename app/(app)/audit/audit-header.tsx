import Link from "next/link";
import type { LiveTable } from "@/components/app/live-refresh";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 'YYYY-MM-DD' from ?date=, else today in Jakarta. */
export function auditDate(raw: string | undefined): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw ?? "") ? raw! : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

export function AuditHeader({ title, date, active, live = ["audits", "movements", "pick_tasks"], putaway = true }: {
  title: string; date: string; active: "picking" | "putaway"; live?: LiveTable[];
  /** show the picking / putaway switch (putaway audit is supervisor-only) */
  putaway?: boolean;
}) {
  return (
    <PageHeader title={title} live={live}>
      <div className="flex flex-wrap items-center gap-2">
        {putaway && (
          <nav className="flex rounded-md border border-steel-300 bg-white text-sm">
            {(["picking", "putaway"] as const).map((k) => (
              <Link key={k} href={`/audit/${k}?date=${date}`}
                className={cn("px-3 py-2 first:rounded-l-md last:rounded-r-md", active === k ? "bg-ckb text-white" : "hover:bg-steel-100")}>
                {k === "picking" ? "Picking" : "Putaway"}
              </Link>
            ))}
          </nav>
        )}
        <form className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={date} className="w-auto" aria-label="Tanggal" />
          <Button type="submit" variant="outline">Tampilkan</Button>
        </form>
      </div>
    </PageHeader>
  );
}
