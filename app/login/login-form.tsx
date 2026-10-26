"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAction } from "./actions";
import { Eye, EyeOff, Loader2, User, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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

  // One small shake when the server refuses the sign-in.
  useEffect(() => {
    if (state.error) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 400);
      return () => clearTimeout(t);
    }
  }, [state.error]);

  const usernameEmpty = touched && username.length === 0;
  const passwordEmpty = touched && password.length === 0;

  return (
    <form
      action={run}
      className={cn("space-y-5", shake && "animate-shake")}
    >
      <input type="hidden" name="next" value={next} />

      {/* Username */}
      <div className="login-field" style={{ "--d": "140ms" } as React.CSSProperties}>
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
      <div className="login-field" style={{ "--d": "220ms" } as React.CSSProperties}>
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
      <div className="login-field flex items-center" style={{ "--d": "300ms" } as React.CSSProperties}>
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

      {/* Server message */}
      {state.error && (
        <div role="alert" className="animate-fade-in flex items-start gap-2.5 rounded-md bg-bad/10 p-3 text-sm text-bad">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{state.error}</p>
        </div>
      )}

      {/* Submit */}
      <div className="login-field" style={{ "--d": "360ms" } as React.CSSProperties}>
        <Button type="submit" className="h-12 w-full text-base transition-transform hover:-translate-y-px active:translate-y-0 disabled:translate-y-0" disabled={pending} aria-busy={pending}>
          {pending ? (
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