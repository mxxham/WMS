"use client";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/**
 * A button that opens a one-sentence summary and only runs `onConfirm` after
 * the second tap. `onConfirm` returns an error message, or null on success.
 */
export function ConfirmButton({ title, summary, confirmLabel = "Konfirmasi", onConfirm, extra, children, ...props }: {
  title: string; summary: string; confirmLabel?: string; onConfirm: () => Promise<string | null>;
  /** Shown under the summary, e.g. what the action does to other rows. */
  extra?: React.ReactNode;
} & Omit<ButtonProps, "onClick">) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err); else setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button {...props}>{children}</Button></DialogTrigger>
      <DialogContent title={title}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">{summary}</p>
          {extra}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy}>{busy ? "Memproses…" : confirmLabel}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
