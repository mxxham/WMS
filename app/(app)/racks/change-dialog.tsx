import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { codeRangeText } from "@/lib/racks";
import { cn, fmtNum } from "@/lib/utils";

/** One change the selection bar offers: the RPC field + value, and the words around it. */
export type ChangeKind = {
  field: "STATE" | "OWNER"; value: string;
  /** button and confirm label, e.g. "Blokir" */
  label: string;
  /** the summary's verb phrase, e.g. "Blokir" -> "Blokir 38 bin CF21A01–CF39A02." */
  verb: string;
  danger?: boolean;
};

type Preview = { bin_code: string; ok: boolean; reason: string | null };

/**
 * The one confirmation of a state or owner change: the database's own preview (bin_change_preview) says
 * which bins will change and why the others will not; a reason and a name are asked; the change applies
 * exactly the previewed rule (apply_bin_change re-runs it under a lock).
 */
export function ChangeDialog({ codes, kind, onDone }: { codes: string[]; kind: ChangeKind; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPreview(null); setError(null); setReason("");
    const { data, error } = await createClient().rpc("bin_change_preview", { p_codes: codes, p_field: kind.field, p_value: kind.value });
    if (error) return setError(error.message);
    setPreview((data ?? []) as Preview[]);
  }

  const ok = preview?.filter((p) => p.ok) ?? [];
  const refused = preview?.filter((p) => !p.ok) ?? [];

  async function run() {
    if (reason.trim().length < 3) return setError("Tulis alasannya (minimal 3 huruf).");
    if (person.trim().length < 2) return setError("Isi nama Anda dulu.");
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("apply_bin_change", {
      p_codes: codes, p_field: kind.field, p_value: kind.value, p_reason: reason, p_by_name: person,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false);
    onDone();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant={kind.danger ? "danger" : "outline"} className={cn(!kind.danger && "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
          {kind.label}
        </Button>
      </DialogTrigger>
      <DialogContent title={kind.label}>
        <div className="space-y-4">
          {!preview && !error && <p className="text-sm text-steel-500">Memeriksa {fmtNum(codes.length)} bin…</p>}
          {preview && (
            <p className="rounded-md bg-plate/30 p-3 text-base">
              {ok.length
                ? `${kind.verb} ${fmtNum(ok.length)} bin ${codeRangeText(ok.map((p) => p.bin_code)).replace(/ \(\d+ bin\)$/, "")}.`
                : "Tidak ada bin yang bisa diubah."}
              {refused.length > 0 && ` ${fmtNum(refused.length)} bin tidak ikut diubah.`}
            </p>
          )}
          {refused.length > 0 && (
            <details className="rounded-md border border-steel-100 p-2 text-sm" open={refused.length <= 6}>
              <summary className="cursor-pointer font-semibold">Tidak ikut diubah ({fmtNum(refused.length)})</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {refused.map((p) => (
                  <li key={p.bin_code} className="flex gap-2"><span className="font-cond font-bold">{p.bin_code}</span><span className="text-steel-500">{p.reason}</span></li>
                ))}
              </ul>
            </details>
          )}
          {ok.length > 0 && (
            <>
              <div>
                <Label htmlFor="change-reason">Alasan</Label>
                <Input id="change-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. rak penyok, menunggu perbaikan" />
              </div>
              <PersonNameField id="change-name" value={person} onChange={setPerson} label="Nama Anda" />
            </>
          )}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" variant={kind.danger ? "danger" : "default"} onClick={run} disabled={busy || ok.length === 0}>
              {busy ? "Memproses…" : kind.label}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** ABC class and capacity for the selection (set_bin_attrs). */
export function AttrDialog({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [abc, setAbc] = useState("");
  const [capacity, setCapacity] = useState("");
  const [reason, setReason] = useState("");
  const [person, setPerson] = usePersonName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = [abc && (abc === "CLEAR" ? "hapus kelas ABC" : `kelas ${abc}`), capacity && `kapasitas ${capacity} palet`].filter(Boolean).join(" dan ");

  async function run() {
    if (!changes) return setError("Pilih kelas ABC atau kapasitas.");
    if (reason.trim().length < 3) return setError("Tulis alasannya (minimal 3 huruf).");
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("set_bin_attrs", {
      p_codes: codes, p_abc: abc || null, p_capacity: capacity ? Number(capacity) : null, p_reason: reason, p_by_name: person,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); onDone(); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20">Kelas ABC &amp; kapasitas</Button>
      </DialogTrigger>
      <DialogContent title="Kelas ABC & kapasitas">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="attr-abc">Kelas ABC</Label>
              <Select id="attr-abc" value={abc} onChange={(e) => setAbc(e.target.value)}>
                <option value="">tidak diubah</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="CLEAR">hapus kelas</option>
              </Select></div>
            <div><Label htmlFor="attr-cap">Kapasitas (palet)</Label>
              <Input id="attr-cap" type="number" min={0.5} step={0.5} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="tidak diubah" /></div>
          </div>
          {changes && <p className="rounded-md bg-plate/30 p-3 text-base">Ubah {fmtNum(codes.length)} bin {codeRangeText(codes).replace(/ \(\d+ bin\)$/, "")}: {changes}.</p>}
          <div><Label htmlFor="attr-reason">Alasan</Label><Input id="attr-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <PersonNameField id="attr-name" value={person} onChange={setPerson} label="Nama Anda" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={run} disabled={busy}>{busy ? "Memproses…" : "Simpan"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
