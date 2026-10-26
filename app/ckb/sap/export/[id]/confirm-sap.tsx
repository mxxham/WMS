"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { callRpc } from "@/components/ckb/rpc-button";

/** Record SAP's own document number: the only thing that marks an export as posted. */
export function ConfirmSap({ exportId, refNo }: { exportId: string; refNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_confirm_sap_export", { p_export: exportId, p_sap_ref: doc, p_note: note || null });
    setBusy(false);
    if (err) setError(err); else { setOpen(false); router.refresh(); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button>Catat posting SAP</Button></DialogTrigger>
      <DialogContent title="Catat posting SAP" description={`Isi hanya setelah SAP benar-benar memposting ${refNo}.`}>
        <div className="space-y-3">
          <div><Label htmlFor="sap-doc">Nomor dokumen SAP</Label><Input id="sap-doc" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="mis. 4900012345" /></div>
          <div><Label htmlFor="sap-note">Catatan (opsional)</Label><Input id="sap-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. diposting MI10 oleh tim SAP" /></div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy || doc.trim().length < 3}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
