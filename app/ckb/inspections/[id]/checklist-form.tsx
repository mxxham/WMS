"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmButton } from "@/components/app/confirm-button";
import { callRpc } from "@/components/ckb/rpc-button";
import { DAMAGE_CLASS, inspectionResult, submitProblems, type CheckResult, type ChecklistItem, type DamageClass, type Response } from "@/lib/ckb/inspection";
import { cn } from "@/lib/utils";

const RESULTS: { v: CheckResult; label: string; on: string }[] = [
  { v: "OK", label: "OK", on: "bg-ok text-white ring-ok" },
  { v: "NG", label: "NG", on: "bg-bad text-white ring-bad" },
  { v: "NA", label: "N/A", on: "bg-steel-500 text-white ring-steel-500" },
];

/** The checklist while it is a draft: answers are saved as a whole; Kirim freezes them. */
export function ChecklistForm({ inspectionId, checklist, answers, findings, damageClass, photoCount, requirePhotoOnNg }: {
  inspectionId: string; checklist: ChecklistItem[]; answers: Response[]; findings: string | null; damageClass: DamageClass; photoCount: number; requirePhotoOnNg: boolean;
}) {
  const router = useRouter();
  const [resp, setResp] = useState<Record<string, Response>>(Object.fromEntries(answers.map((a) => [a.key, a])));
  const [find, setFind] = useState(findings ?? "");
  const [damage, setDamage] = useState<DamageClass>(damageClass);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const set = (key: string, patch: Partial<Response>) => setResp((r) => ({ ...r, [key]: { ...(r[key] ?? { key }), ...patch, key } }));
  const list = Object.values(resp);
  const problems = submitProblems({ checklist, responses: list, photoCount, requirePhotoOnNg, damageClass: damage, findings: find });
  const categories = [...new Set(checklist.map((c) => c.category ?? "Umum"))];

  async function save(): Promise<string | null> {
    setBusy(true); setMsg({});
    const [, err] = await callRpc("ckb_save_inspection_draft", { p_id: inspectionId, p_responses: list, p_findings: find || null, p_damage_class: damage });
    setBusy(false);
    if (err) { setMsg({ error: err }); return err; }
    setMsg({ ok: "Draf tersimpan." }); router.refresh();
    return null;
  }
  async function submit(): Promise<string | null> {
    const err = await save();
    if (err) return err;
    const [, e2] = await callRpc("ckb_submit_inspection", { p_id: inspectionId });
    if (e2) return e2;
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-5">
      {categories.map((cat) => (
        <section key={cat} className="space-y-2">
          <h3 className="text-sm font-semibold text-steel-500">{cat}</h3>
          {checklist.filter((c) => (c.category ?? "Umum") === cat).map((c) => {
            const a = resp[c.key];
            return (
              <div key={c.key} className="rounded-md border border-steel-100 p-3">
                <p className="text-sm font-medium">{c.label}{c.required && <span className="text-bad"> *</span>}</p>
                <div className="mt-2">
                  {c.kind === "CHECK" && (
                    <div className="flex gap-2" role="radiogroup" aria-label={c.label}>
                      {RESULTS.map((r) => (
                        <button key={r.v} type="button" role="radio" aria-checked={a?.result === r.v} onClick={() => set(c.key, { result: a?.result === r.v ? null : r.v })}
                          className={cn("min-h-11 min-w-16 rounded-md px-4 font-semibold ring-1", a?.result === r.v ? r.on : "bg-white ring-steel-300 hover:bg-steel-100")}>{r.label}</button>
                      ))}
                    </div>
                  )}
                  {c.kind === "NUMBER" && <NumberField label={c.label} value={a?.value_num ?? null} onChange={(v) => set(c.key, { value_num: v })} />}
                  {c.kind === "TEXT" && <Input aria-label={c.label} value={a?.value_text ?? ""} onChange={(e) => set(c.key, { value_text: e.target.value })} />}
                </div>
                {(a?.result === "NG" || c.kind === "CHECK") && (
                  <Input aria-label={`Catatan ${c.label}`} className="mt-2" placeholder={a?.result === "NG" ? "Catatan wajib: apa yang tidak sesuai" : "Catatan (opsional)"}
                    value={a?.note ?? ""} onChange={(e) => set(c.key, { note: e.target.value })} />
                )}
              </div>
            );
          })}
        </section>
      ))}
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <div><Label htmlFor="dmg">Kelas kerusakan</Label>
          <Select id="dmg" value={damage} onChange={(e) => setDamage(e.target.value as DamageClass)}>
            {(Object.keys(DAMAGE_CLASS) as DamageClass[]).map((d) => <option key={d} value={d}>{DAMAGE_CLASS[d]}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="find">Temuan / tindakan</Label><Input id="find" value={find} onChange={(e) => setFind(e.target.value)} /></div>
      </div>
      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 rounded-md bg-warn/10 py-2 pl-8 pr-3 text-sm">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {msg.error && <p role="alert" className="text-sm text-bad">{msg.error}</p>}
      {msg.ok && <p role="status" className="text-sm text-ok">{msg.ok}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan draf"}</Button>
        <ConfirmButton disabled={problems.length > 0} title="Kirim inspeksi"
          summary={`Jawaban dikunci dan dikirim untuk review. Hasil: ${inspectionResult(list) === "FAIL" ? "ADA TEMUAN" : "LULUS"}.`} confirmLabel="Kirim"
          onConfirm={submit}>Kirim untuk review</ConfirmButton>
      </div>
    </div>
  );
}

/** Keeps what was typed ("12," on the way to "12,5") and reports a number only when it is one. */
function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [raw, setRaw] = useState(value === null ? "" : String(value).replace(".", ","));
  return (
    <Input aria-label={label} inputMode="decimal" className="max-w-40" value={raw}
      onChange={(e) => {
        setRaw(e.target.value);
        const t = e.target.value.trim();
        onChange(/^\d+(,\d+)?$/.test(t) ? Number(t.replace(",", ".")) : null);
      }} />
  );
}
