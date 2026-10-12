"use client";
import { createContext, useContext } from "react";
import type { Role } from "@/lib/types";

type Session = { name: string; username: string; role: Role; loginRequired: boolean };
const Ctx = createContext<Session | null>(null);

/** The signed-in account, for client components (filled once by the app layout). */
export function SessionProvider({ user, children }: { user: Session; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx);
