"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expectedExpiry } from "@/lib/batch-code";
import {
  LINE_STATE_LABEL, PICK_ERROR_LABEL,
  type LineState, type PickError,
} from "@/lib/pick-audit";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

export type MoveLineView = {
  task_id: string; seq: number; sku: string; description: string; uom: string | null;
  from_bin: string; from_zone: string | null; to_bin: string; to_zone: string | null;
  batch_lot: string; expiry_date: string | null;
  planned_qty: number; moved_qty: number; deviation_reason: string | null;
  picked_by_name: string | null; bulk_posted: boolean; scanned_code: string | null;
  state: LineState; attempts: number;
  /** only once the line has been audited (or was moved as 0): what the mover reported */
  picked?: { qty: number; planned_qty: number; batch: string; expiry: string | null; deviation: string | null };
};

export type MoveAttemptView = {
  id: string; task_id: string; attempt_no: number; checker_name: string; found_sku: string; found_batch: string; found_expiry: string | null;
  counted_qty: number; damaged: boolean; expected_sku: string; expected_batch: string; expected_expiry: string | null; expected_qty: number;
  errors: PickError[]; result: "OK" | "MISMATCH"; note: string | null; resolution: string | null; resolved_by_name: string | null;
  resolved_at: string | null; resolution_note: string | null; created_at: string; legacy: boolean;
  /** recorded again by a supervisor after a mistaken save (Ubah) */
  correction?: boolean;
};

type SaveResult = {
  result: "OK" | "MISMATCH"; errors: PickError[]; attempt: number;
  expected: { sku: string; batch: string; expiry: string | null; qty: number };
  found: { sku: string; batch: string; expiry: string | null; qty: number; damaged: boolean };
};

const LINE_TONE: Record<LineState, string> = {
  AUTO_PASS: "text-steel-500", TODO: "text-steel-500", OK: "text-ok", MISMATCH: "text-bad", RESOLVED: "text-warn",
};

/**
 * A checker records what arrived at the pickface bin without seeing what the
 * mover reported; the database compares. A mismatch is fixed on the floor and
 * audited again, or corrected by a supervisor (Ubah).
 */
export function MoveAuditClient({ line, attempts, supervisor, frozen }: {
  line: MoveLineView; attempts: MoveAttemptView[]; supervisor: boolean; frozen: boolean;
}) {
  const [audit, setAudit] = useState<{ line: MoveLineView; flash?: string; correct?: boolean } | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-1">
      {!frozen && (line.state === "TODO" || line.state === "MISMATCH") && (
        <Button
          size="sm"
          variant={line.state === "TODO" ? "default" : "outline"}
          onClick={() => setAudit({ line })}
        >
          <ClipboardCheck className="h-4 w-4" />{line.state === "TODO" ? "Audit" : "Audit ulang"}
        </Button>
      )}
      {!frozen && supervisor && line.state === "OK" && (
        <Button size="sm" variant="ghost" className="underline" onClick={() => setAudit({ line, correct: true })}>Ubah</Button>
      )}
      {audit && <MoveAuditDialog
        key={`${audit.line.task_id}|${audit.correct ? "ubah" : ""}`}
        line={audit.line} rpc="record_move_audit"
        target={{ p_task_id: audit.line.task_id }} correct={audit.correct} flash={audit.flash}
        onOpen={(line, flash) => setAudit({ line, flash })} onClose={() => setAudit(null)} />}
    </div>
  );
}

/** What the dialog needs of a line, from pick_tasks (0088). */
export type MoveAuditLine = { seq: number; sku: string; description: string; from_bin: string; to_bin: string };

export function MoveAuditDialog<L extends MoveAuditLine>({ line, rpc, target, expectedLabel = "Dilaporkan petugas pindah", correct = false, flash, onOpen, onClose }: {
  line: L;
  /** the function that records the attempt, and the argument naming the line */
  rpc: "record_move_audit";
  target: Record<string, string>;
  /** heading of the expected column in the result */
  expectedLabel?: string;
  /** Ubah: record a line that already passed again, with a reason (supervisor / admin) */
  correct?: boolean;
  flash?: string;
  onOpen: (line: L, flash: string) => void; onClose: () => void;
}) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [skuInput, setSkuInput] = useState("");
  const [found, setFound] = useState<{ code: string; sku: string } | null>(null);
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [counted, setCounted] = useState("");
  const [damaged, setDamaged] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);

  const n = Number(counted);
  const valid = checker.trim().length >= 2 && !!found && counted.trim() !== "" && Number.isFinite(n) && n >= 0;
  const hint = expectedExpiry(batch);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Isi nama checker, scan karton / SKU dan jumlah karton.");
    if (correct && !note.trim()) return setError("Isi alasan ubah di catatan.");
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc(rpc, {
      ...target, p_checker_name: checker, p_found: found!.code, p_counted: n,
      p_batch: batch, p_expiry: expiry || null, p_damaged: damaged, p_note: note,
      p_correct: correct,
    });
    setBusy(false);
    if (error) return setError(error.message);
    const r = data as SaveResult;
    router.refresh();
    if (r.result === "OK") {
      return onOpen(line, `#${line.seq} ${line.sku} sesuai`);
    }
    setSaved(r);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${correct ? "Ubah audit" : "Audit"} pindahan #${line.seq} · ${line.sku}`} description={`${line.description} · ${line.from_bin} → ${line.to_bin}`}>
        {saved ? <MoveSavedResult r={saved} onClose={onClose} expectedLabel={expectedLabel} /> : (
          <form onSubmit={save} className="space-y-4">
            {flash && <p role="status" className="flex items-center gap-1 rounded-md bg-ok/10 p-2 text-sm font-semibold text-ok"><CheckCircle2 className="h-4 w-4" />{flash}</p>}
            <p className="rounded-md bg-plate/30 p-3 text-sm">Hitung dan catat apa yang tiba di bin pickface. Jumlah dan batch dari petugas pindah tidak ditampilkan.</p>
            {correct && <p className="rounded-md bg-warn/10 p-2 text-sm">Audit sebelumnya tetap tersimpan sebagai riwayat. Isi yang benar dan alasan ubah.</p>}
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan petugas pindah baris ini)" id="checker" />
            <div>
              <Label htmlFor="found">Scan karton / ketik SKU yang ada di bin pickface</Label>
              <ItemScanInput id="found" value={skuInput} autoFocus
                onChange={(v) => { setSkuInput(v); if (found && v !== found.sku && v !== found.code) setFound(null); }}
                onItem={(it, code) => { setFound(it ? { code, sku: it.sku } : null); if (it) batchRef.current?.focus(); }} />
              {found && <p className="mt-1 text-xs font-semibold text-ok">Terbaca: {found.sku}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="batch">Batch di karton</Label>
                <Input id="batch" ref={batchRef} value={batch}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); countRef.current?.focus(); } }} onChange={(e) => setBatch(e.target.value)} placeholder="mis. 14H26JJ" autoCapitalize="characters" />
              </div>
              <div>
                <Label htmlFor="expiry">Expired (kalau tercetak)</Label>
                <Input id="expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                {hint && !expiry && <button type="button" className="mt-1 text-xs underline" onClick={() => setExpiry(hint)}>perkiraan dari batch: {fmtDate(hint)}</button>}
              </div>
            </div>
            <div>
              <Label htmlFor="counted">Jumlah karton dihitung</Label>
              <Input id="counted" ref={countRef} type="number" inputMode="numeric" min={0} step="any" value={counted} onChange={(e) => setCounted(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} />Ada karton rusak</label>
            <div>
              <Label htmlFor="note">{correct ? "Alasan ubah (wajib)" : "Catatan (wajib bila tidak sesuai)"}</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. 2 karton penyok, label batch pudar" />
            </div>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Simpan audit"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoveSavedResult({ r, onClose, expectedLabel }: {
  r: SaveResult; onClose: () => void; expectedLabel: string;
}) {
  const rows: [string, string, string][] = [
    ["SKU", r.found.sku, r.expected.sku],
    ["Batch", r.found.batch || "–", r.expected.batch || "–"],
    ["Expired", fmtDate(r.found.expiry), fmtDate(r.expected.expiry)],
    ["Jumlah", fmtNum(r.found.qty), fmtNum(r.expected.qty)],
  ];
  return (
    <div className="space-y-4">
      <p className={cn("rounded-md p-3 text-base font-semibold", r.result === "OK" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
        {r.result === "OK" ? "Sesuai. Baris lolos audit." : `Selisih: ${r.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}`}
      </p>
      <Table>
        <thead><tr><Th /><Th>Di bin pickface</Th><Th>{expectedLabel}</Th></tr></thead>
        <tbody>{rows.map(([k, f, x]) => (
          <tr key={k} className={cn(f !== x && k !== "Expired" && "text-bad")}><Td>{k}</Td><Td className="font-semibold">{f}</Td><Td>{x}</Td></tr>
        ))}</tbody>
      </Table>
      {r.found.damaged && <p className="text-sm text-bad">Ada karton rusak: ganti dengan karton baik.</p>}
      {r.result === "MISMATCH" && (
        <p className="text-sm">Perbaiki di lantai: ambil yang kurang, kembalikan yang lebih, tukar barang atau batch yang salah. Setelah itu audit ulang.</p>
      )}
      <Button size="lg" variant="outline" className="w-full" onClick={onClose}>Tutup</Button>
    </div>
  );
}