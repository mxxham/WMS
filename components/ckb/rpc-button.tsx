"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";

/** Postgres error text without the noise PostgREST adds. */
export function rpcMessage(e: { message?: string } | null | undefined): string {
  return (e?.message ?? "Gagal. Coba lagi.").replace(/^(ERROR:\s*)/, "");
}

/** Call a CKB RPC as the signed-in user. Returns [data, error message]. */
export async function callRpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<[T | null, string | null]> {
  const { data, error } = await createClient().rpc(name, args);
  return error ? [null, rpcMessage(error)] : [data as T, null];
}

/**
 * One consequential action: the button opens a one-sentence summary (and, if asked, a reason box),
 * and the RPC runs only on the second tap. The database decides; its message is shown as is.
 */
export function RpcButton({ rpc, args, title, summary, confirmLabel = "Konfirmasi", reason, onDone, children, ...props }: {
  rpc: string; args: Record<string, unknown>; title: string; summary: string; confirmLabel?: string;
  /** a text box whose value is sent as `reason.arg` */
  reason?: { arg: string; label: string; required?: boolean; placeholder?: string };
  onDone?: (data: unknown) => void;
} & Omit<ButtonProps, "onClick">) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (reason?.required && text.trim().length < 3) { setError(`${reason.label} wajib diisi.`); return; }
    setBusy(true); setError(null);
    const [data, err] = await callRpc(rpc, reason ? { ...args, [reason.arg]: text.trim() || null } : args);
    setBusy(false);
    if (err) { setError(err); return; }
    setOpen(false); setText("");
    onDone?.(data);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button {...props}>{children}</Button></DialogTrigger>
      <DialogContent title={title}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">{summary}</p>
          {reason && (
            <div>
              <Label htmlFor={`reason-${rpc}`}>{reason.label}{reason.required ? "" : " (opsional)"}</Label>
              <textarea id={`reason-${rpc}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={reason.placeholder}
                className="w-full rounded-md border border-steel-300 bg-white p-2 text-sm" />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy} variant={props.variant === "danger" ? "danger" : "default"}>{busy ? "Memproses…" : confirmLabel}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
