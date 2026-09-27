"use client";
import { useEffect, useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const KEY = "k1.personName";

const EVENT = "k1-person-name";

/**
 * The name of whoever is doing a control step (count, approval, receipt,
 * hold …). The database records it with the step and refuses the step
 * without one; this device remembers the last name typed.
 */
export function usePersonName(): [string, (v: string) => void] {
  const [name, setName] = useState("");
  useEffect(() => {
    try { setName(localStorage.getItem(KEY) ?? ""); } catch { /* storage unavailable: type it each time */ }
    // Every field on the page shows the same person.
    const sync = (e: Event) => setName((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const set = (v: string) => {
    setName(v);
    try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
  };
  return [name, set];
}

export function PersonNameField({ value, onChange, label = "Nama petugas", id = "person-name", className }: {
  value: string; onChange: (v: string) => void; label?: string; id?: string; className?: string;
}) {
  return (
    <div className={cn("min-w-44", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="nama lengkap" autoComplete="name" required />
    </div>
  );
}

/** A second person's name (approver / recounter) — never remembered. */
export function OtherPersonField({ value, onChange, label, id, notSameAs }: {
  value: string; onChange: (v: string) => void; label: string; id: string; notSameAs?: string;
}) {
  const same = !!value.trim() && !!notSameAs?.trim() && value.trim().toLowerCase() === notSameAs.trim().toLowerCase();
  return (
    <div className="min-w-44">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="nama orang lain" required aria-invalid={same} />
      {same && <p className="mt-1 text-xs text-bad">Harus orang lain.</p>}
    </div>
  );
}
