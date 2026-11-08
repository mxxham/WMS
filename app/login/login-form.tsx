"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAction } from "./actions";
import { Eye, EyeOff, Loader2, User, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NETWORK_MSG } from "@/lib/net";
import { useRouter } from "next/navigation";

/**
 * The sign-in form: username stays in state across the server action (React resets the form after
 * it runs, so only the password is retyped). Field validation shows only after a blur or a failed
 * submit attempt — never on first render.
 */
export function LoginForm({ next }: { next: string }) {
  const [state, run, pending] = useActionState(loginAction, {});
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false); // after first blur / failed native validation
  const [shake, setShake] = useState(false);
  // No internet: the server action never runs, so the refusal is decided here,
  // before the request — the same alert slot, the same message the app shows
  // everywhere else (lib/net).
  const [netErr, setNetErr] = useState(false);
  const leaving = !!state.to;
  const serverMsg = netErr ? NETWORK_MSG : state.error;

  // Signed in. To Home: the login line drives on out to the right (`floor-exit`, globals.css), then
  // Home opens and its line comes in from the left, the same arrow arriving. Home is prefetched while
  // the line runs. Anywhere else, or with reduced motion: straight there, as before. The button keeps
  // its busy state until the page is gone.
  const router = useRouter();
  useEffect(() => {
    const to = state.to;
    if (!to) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (to !== "/home" || reduce) { window.location.assign(to); return; }
    router.prefetch(to);
    document.querySelector("main")?.classList.add("floor-exit");
    // Navigate while the line is still leaving: by the time Home renders, it is gone.
    const t = setTimeout(() => router.push(to), 300);
    return () => clearTimeout(t);
  }, [state.to, router]);

  // A saved username is refilled; the checkbox reflects that.
  useEffect(() => {
    const saved = localStorage.getItem("wms_remembered_username");
    if (saved) {
      setUsername(saved);
      setRemember(true);
    }
  }, []);

  // Persist or drop the remembered username.
  useEffect(() => {
    if (remember && username) localStorage.setItem("wms_remembered_username", username);
    else localStorage.removeItem("wms_remembered_username");
  }, [remember, username]);

  // One small shake when the server (or the offline check) refuses the sign-in.
  useEffect(() => {
    if (serverMsg) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 400);
      return () => clearTimeout(t);
    }
  }, [serverMsg]);

  const usernameEmpty = touched && username.length === 0;
  const passwordEmpty = touched && password.length === 0;

  return (
    <form
      action={run}
      onSubmit={(e) => {
        // A form event coexists with the server action: preventDefault drops the
        // request before it is made. Back online, the next submit clears it.
        if (!navigator.onLine) {
          e.preventDefault();
          setNetErr(true);
        } else {
          setNetErr(false);
        }
      }}
      className={cn("space-y-5", shake && "animate-shake")}
    >
      <input type="hidden" name="next" value={next} />

      {/* Username */}
      <div>
        <Label htmlFor="username">Nama pengguna</Label>
        <div className="relative">
          <User aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-500" />
          <Input
            id="username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.trimStart())}
            onBlur={() => setTouched(true)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus
            disabled={pending}
            className={cn(
              "h-11 pl-9 pr-10",
              usernameEmpty ? "border-bad focus:border-bad" : "focus:border-ckb",
            )}
            aria-invalid={usernameEmpty || undefined}
            aria-describedby={usernameEmpty ? "username-error" : undefined}
          />
        </div>
        {usernameEmpty && (
          <p id="username-error" role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-bad">
            <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
            Nama pengguna wajib diisi
          </p>
        )}
      </div>

      {/* Password */}
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Kata sandi</Label>
        </div>
        <div className="relative">
          <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-500" />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            autoComplete="current-password"
            required
            disabled={pending}
            className={cn(
              "h-11 pl-9 pr-10",
              passwordEmpty ? "border-bad focus:border-bad" : "focus:border-ckb",
            )}
            aria-invalid={passwordEmpty || undefined}
            aria-describedby={passwordEmpty ? "password-error" : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-steel-500 transition-colors hover:text-steel"
            aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            aria-pressed={showPassword}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
          </button>
        </div>
        {passwordEmpty && (
          <p id="password-error" role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-bad">
            <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
            Kata sandi wajib diisi
          </p>
        )}
      </div>

      {/* Remember me */}
      <div className="flex items-center">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-steel-700">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={pending}
            className="h-4 w-4 rounded border-steel-300 accent-ckb"
          />
          Ingat nama saya di perangkat ini
        </label>
      </div>

      {/* Server message: the offline refusal or the sign-in refusal */}
      {serverMsg && (
        <div role="alert" className="animate-fade-in flex items-start gap-2.5 rounded-md bg-bad/10 p-3 text-sm text-bad">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{serverMsg}</p>
        </div>
      )}

      {/* Submit */}
      <div>
        <Button type="submit" variant="floor" className={cn("floor-door h-12 w-full text-base focus-visible:ring-2 focus-visible:ring-jeir-navy focus-visible:ring-offset-2",
          // Signed in: the door folds into the line at full colour, not in the faded disabled look.
          leaving && "disabled:opacity-100")}
          disabled={pending || leaving} aria-busy={pending || leaving}>
          {pending || leaving ? (
            <>
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              Masuk…
            </>
          ) : (
            "Masuk"
          )}
        </Button>
      </div>
    </form>
  );
}