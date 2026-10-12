"use client";
import { LogOut } from "lucide-react";
import { ActionMenu, MenuSection } from "@/components/app/action-menu";
import { useSession } from "./session";

const ROLE: Record<string, string> = { operator: "Operator", supervisor: "Supervisor", admin: "Admin" };

/** Keluar: a plain form POST to /keluar, so it works even if scripts failed to load. */
function SignOut({ className }: { className?: string }) {
  return (
    <form action="/keluar" method="post">
      <button type="submit" className={className}><LogOut className="h-4 w-4" />Keluar</button>
    </form>
  );
}

/** Bottom of the desktop sidebar: who is signed in, and Keluar. */
export function AccountBox() {
  const s = useSession();
  if (!s) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium">{s.name}</span>
        <span className="block text-xs text-white/60">{s.username} · {ROLE[s.role] ?? s.role}</span>
      </span>
      <SignOut className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-white/85 hover:bg-ckb-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plate" />
    </div>
  );
}

/** Phone page header: the account's initial; tapping shows name, role and Keluar. */
export function AccountButton() {
  const s = useSession();
  if (!s) return null;
  return (
    <ActionMenu title={s.name} trigger={
      <button type="button" aria-label={`Akun: ${s.name}`} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-plate font-cond text-lg font-bold text-steel lg:hidden">
        {s.name.charAt(0).toUpperCase()}
      </button>
    }>
      <p className="px-3 pb-2 text-sm text-steel-500">{s.username} · {ROLE[s.role] ?? s.role}</p>
      <MenuSection><SignOut /></MenuSection>
    </ActionMenu>
  );
}
