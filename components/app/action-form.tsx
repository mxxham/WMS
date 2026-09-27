"use client";
import { useActionState } from "react";
import type { ActionState } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";

/** Small wrapper: server action + pending state + result message. */
export function ActionForm({ action, submit, children }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; submit: string; children: React.ReactNode }) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form action={run} className="space-y-3">
      {children}
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Memproses…" : submit}</Button>
    </form>
  );
}
