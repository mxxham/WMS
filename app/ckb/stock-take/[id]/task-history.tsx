"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callRpc } from "@/components/ckb/rpc-button";
import { EvidencePanel } from "@/components/ckb/evidence-panel";
import type { CountRow, NoteRow, TaskEvidence } from "@/lib/ckb/stocktake-data";
import { fmtDateTime, fmtNum } from "@/lib/utils";

const NOTE_KIND: Record<string, string> = { INVESTIGATION: "Investigasi", RECOUNT_REQUEST: "Minta hitung ulang", DECISION: "Keputusan" };

/** Every count (all rounds, nothing erased), every note, the evidence, and a box for a new note. */
export function TaskHistory({ taskId, uom, counts, notes, evidence, me, canNote, canUpload, selectedCount, onSelectCount }: {
  taskId: string; uom: string; counts: CountRow[]; notes: NoteRow[]; evidence: TaskEvidence[]; me: string; canNote: boolean; canUpload: boolean;
  selectedCount?: string | null; onSelectCount?: (id: string) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function addNote() {
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_add_task_note", { p_task: taskId, p_note: note });
    setBusy(false);
    if (err) setError(err); else { setNote(""); router.refresh(); }
  }
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="mb-1 font-medium">Hitungan</p>
        {counts.length === 0 ? <p className="text-steel-500">Belum ada hitungan.</p> : (
          <ol className="space-y-1">
            {counts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-paper px-2 py-1.5">
                {onSelectCount && <input type="radio" name={`count-${taskId}`} aria-label={`Pilih hitungan ${fmtNum(Number(c.qty), 3)}`} className="h-4 w-4"
                  checked={selectedCount === c.id} onChange={() => onSelectCount(c.id)} />}
                <span className="font-cond text-base font-semibold tabular">{fmtNum(Number(c.qty), 3)} {uom}</span>
                <span className="text-xs text-steel-500">putaran {c.round} · {c.counter_name} · {fmtDateTime(c.counted_at)}</span>
                {c.batch_matches === false && <span className="text-xs text-bad">batch beda{c.observed_batch ? `: ${c.observed_batch}` : ""}</span>}
                {c.expiry_matches === false && <span className="text-xs text-bad">expired beda{c.observed_expiry ? `: ${c.observed_expiry}` : ""}</span>}
                {c.note && <span className="w-full text-xs text-steel-700">“{c.note}”</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
      {notes.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Catatan</p>
          <ul className="space-y-1">{notes.map((n) => <li key={n.id}><span className="text-xs text-steel-500">{NOTE_KIND[n.kind] ?? n.kind} · {n.by_name} · {fmtDateTime(n.at)}</span><br />{n.note}</li>)}</ul>
        </div>
      )}
      {canNote && (
        <div className="flex gap-2">
          <Input aria-label="Catatan investigasi" placeholder="Catatan investigasi" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="outline" onClick={addNote} disabled={busy || note.trim().length < 3}>{busy ? "…" : "Tambah"}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
      <details>
        <summary className="cursor-pointer text-ckb">Bukti ({evidence.length})</summary>
        <div className="mt-2"><EvidencePanel entityType="COUNT_TASK" entityId={taskId} rows={evidence} canUpload={canUpload} me={me} lead defaultKind="DISCREPANCY" /></div>
      </details>
    </div>
  );
}
