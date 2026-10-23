import type { Metadata } from "next";
import Link from "next/link";
import { requireAppAccess } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { CKB_MODULES } from "./modules";

/** CKB 3PL app shell — outside the Shell WMS (app) route group; the root layout owns <html>/<body>. */
export const metadata: Metadata = { title: "CKB 3PL" };

export default async function CkbLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppAccess("ckb_3pl");

  // Keluar as a plain POST form, rendered once for desktop and once for phone.
  const signOut = (
    <form action="/keluar" method="post">
      <Button type="submit" variant="ghost" size="sm" className="text-white/85 hover:bg-white/10">Keluar</Button>
    </form>
  );

  // Group modules by their group for the sidebar rail.
  const groups = ["Operasional", "Data & laporan", "Pengaturan"] as const;

  return (
    <div className="min-h-screen bg-white text-steel">
      {/* Blue chrome only — full sidebar on desktop… */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col bg-jeir-navy text-white lg:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <span className="block font-cond text-xl font-bold">CKB 3PL</span>
          <span className="mt-1 inline-block rounded-plate bg-white/10 px-1.5 font-cond text-xs font-bold text-white/70">Warehouse 5</span>
        </div>

        {/* Module navigation rail */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {groups.map((group) => {
            const modules = CKB_MODULES.filter((m) => m.group === group);
            if (modules.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <span className="block text-[11px] uppercase tracking-wide text-white/50 px-3 py-1">
                  {group}
                </span>
                {modules.map((module) => (
                  <Link
                    key={module.href}
                    href={module.href}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <span className="truncate">{module.label}</span>
                    <span className="flex-shrink-0 rounded-plate bg-white/10 px-1.5 text-[10px] font-medium text-white/70">
                      Segera
                    </span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 px-4 py-4 text-sm">
          <span className="truncate text-white/70">{user.name}</span>
          {signOut}
        </div>
      </aside>
      {/* …and a slim blue top bar on phone in its place. */}
      <header className="flex h-14 items-center justify-between gap-3 bg-jeir-navy px-4 text-white lg:hidden">
        <span className="font-cond text-xl font-bold">CKB 3PL</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="max-w-[140px] truncate text-white/70">{user.name}</span>
          {signOut}
        </div>
      </header>
      <div className="lg:pl-72">
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      </div>
    </div>
  );
}
