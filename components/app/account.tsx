"use client";
import { LogIn, LogOut } from "lucide-react";
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

/** Login not required (today): anyone can still sign in as their own account. */
function SignInAsOther({ className }: { className?: string }) {
  return <a href="/login" className={className}><LogIn className="h-4 w-4" />Masuk sebagai akun lain</a>;
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

/** Under the sidebar account box while login is not required. */
export function AccountSwitch() {
  const s = useSession();
  if (!s || s.loginRequired) return null;
  return (
    <div className="px-4 pb-3 text-xs">
      <SignInAsOther className="inline-flex min-h-9 items-center gap-1 text-white/70 underline-offset-2 hover:text-white hover:underline" />
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
      <MenuSection>{!s.loginRequired && <div><SignInAsOther /></div>}<SignOut /></MenuSection>
    </ActionMenu>
  );
}
