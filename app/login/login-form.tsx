"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, run, pending] = useActionState(loginAction, {});
  // React resets a form after its action runs; keep the username so only the password is retyped.
  const [username, setUsername] = useState("");
  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div><Label htmlFor="username">Nama pengguna</Label>
        <Input id="username" name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></div>
      <div><Label htmlFor="password">Kata sandi</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <Button type="submit" className="h-12 w-full text-base" disabled={pending}>{pending ? "Masuk…" : "Masuk"}</Button>
    </form>
  );
}
