"use client";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Th, Td } from "@/components/ui/table";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Pill } from "@/components/ckb/ui";
import { CKB_ROLE_LABEL, type CkbRole } from "@/lib/ckb/permissions";
import { PASSWORD_MIN } from "@/lib/username";
import { createCkbUser, resetCkbPassword, setCkbAccess, setCkbApp } from "./actions";

export type CkbUserRow = { id: string; name: string; username: string; active: boolean; apps: string[]; ckbRole: CkbRole | null; customers: string[] };
type Customer = { id: string; name: string; active: boolean };
const ROLES: CkbRole[] = ["operator", "supervisor", "admin", "customer"];

export function UsersClient({ rows, customers, me }: { rows: CkbUserRow[]; customers: Customer[]; me: string }) {
  const [q, setQ] = useState("");
  const [onlyCkb, setOnlyCkb] = useState(true);
  const cname = new Map(customers.map((c) => [c.id, c.name]));
  const shown = useMemo(() => rows.filter((r) => (!onlyCkb || r.apps.includes("ckb_3pl"))
    && (!q || `${r.name} ${r.username}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, onlyCkb]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-steel-500" aria-hidden="true" />
          <Input aria-label="Cari pengguna" placeholder="Cari nama atau username" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={onlyCkb} onChange={(e) => setOnlyCkb(e.target.checked)} />Hanya yang punya akses CKB</label>
        <div className="ml-auto"><NewUser customers={customers} /></div>
      </div>
      <div className="rounded-lg border border-steel-100 bg-white">
        <Table>
          <thead><tr><Th>Nama</Th><Th>Aplikasi</Th><Th>Peran CKB</Th><Th>Customer</Th><Th /></tr></thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                <Td><span className="font-medium">{u.name}</span><span className="block text-xs text-steel-500">{u.username}{u.active ? "" : " · nonaktif"}</span></Td>
                <Td className="space-x-1">{u.apps.includes("shell_wms") && <Pill>Shell WMS</Pill>}{u.apps.includes("ckb_3pl") && <Pill tone="info">CKB 3PL</Pill>}{u.apps.length === 0 && "–"}</Td>
                <Td>{u.ckbRole ? <Pill tone={u.ckbRole === "customer" ? "warn" : "ok"}>{CKB_ROLE_LABEL[u.ckbRole]}</Pill> : <span className="text-steel-500">–</span>}</Td>
                <Td>{u.customers.map((c) => cname.get(c)).join(", ") || "–"}</Td>
                <Td className="text-right">{u.id === me ? <span className="text-xs text-steel-500">Anda</span> : <UserMenu u={u} customers={customers} />}</Td>
              </tr>
            ))}
            {shown.length === 0 && <tr><Td colSpan={5} className="py-6 text-center text-steel-500">Tidak ada pengguna.</Td></tr>}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

function RoleFields({ role, setRole, picked, setPicked, customers }: {
  role: CkbRole | ""; setRole: (r: CkbRole | "") => void; picked: string[]; setPicked: (p: string[]) => void; customers: Customer[];
}) {
  return (
    <>
      <div>
        <Label htmlFor="ckb-role">Peran CKB</Label>
        <Select id="ckb-role" value={role} onChange={(e) => setRole(e.target.value as CkbRole | "")}>
          <option value="">Tanpa peran</option>
          {ROLES.map((r) => <option key={r} value={r}>{CKB_ROLE_LABEL[r]}</option>)}
        </Select>
      </div>
      {role === "customer" && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-steel-700">Customer yang boleh dilihat</legend>
          <div className="grid grid-cols-2 gap-1">
            {customers.map((c) => (
              <label key={c.id} className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={picked.includes(c.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
                {c.name}{!c.active && " (nonaktif)"}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

function UserMenu({ u, customers }: { u: CkbUserRow; customers: Customer[] }) {
  const [role, setRole] = useState<CkbRole | "">(u.ckbRole ?? "");
  const [picked, setPicked] = useState<string[]>(u.customers);
  const [pw, setPw] = useState("");
  const hasApp = u.apps.includes("ckb_3pl");
  const ckbOnly = hasApp && !u.apps.includes("shell_wms");
  const names = customers.filter((c) => picked.includes(c.id)).map((c) => c.name).join(", ");
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline" size="sm">Atur</Button></DialogTrigger>
      <DialogContent title={u.name} description={u.username}>
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Aplikasi CKB 3PL</h3>
            <ConfirmButton variant={hasApp ? "outline" : "default"} title={hasApp ? "Cabut akses CKB" : "Beri akses CKB"}
              summary={hasApp ? `${u.name} tidak bisa lagi membuka CKB 3PL; peran dan penugasan customernya ikut dihapus. Akses Shell tidak berubah.`
                : `${u.name} bisa membuka CKB 3PL. Ia belum bisa melakukan apa pun sampai diberi peran.`}
              onConfirm={() => setCkbApp(u.id, !hasApp)}>
              {hasApp ? "Cabut akses CKB" : "Beri akses CKB"}
            </ConfirmButton>
          </section>
          {hasApp && (
            <section className="space-y-3 border-t border-steel-100 pt-4">
              <h3 className="text-sm font-semibold">Peran dan customer</h3>
              <RoleFields role={role} setRole={setRole} picked={picked} setPicked={setPicked} customers={customers} />
              <ConfirmButton title="Simpan peran CKB"
                summary={role ? `${u.name} menjadi ${CKB_ROLE_LABEL[role]}${role === "customer" ? ` untuk ${names || "(belum ada customer)"}` : " (melihat semua customer)"}.` : `${u.name} tidak lagi punya peran CKB.`}
                onConfirm={() => setCkbAccess(u.id, role || null, picked)}>
                Simpan peran
              </ConfirmButton>
            </section>
          )}
          {ckbOnly && (
            <section className="space-y-2 border-t border-steel-100 pt-4">
              <h3 className="text-sm font-semibold">Kata sandi</h3>
              <Input type="password" autoComplete="new-password" aria-label="Kata sandi baru" placeholder={`Minimal ${PASSWORD_MIN} karakter`} value={pw} onChange={(e) => setPw(e.target.value)} />
              <ConfirmButton variant="outline" title="Ganti kata sandi" summary={`Kata sandi ${u.name} diganti. Sampaikan langsung kepada orangnya.`}
                onConfirm={() => resetCkbPassword(u.id, pw)} disabled={pw.length < PASSWORD_MIN}>
                Ganti kata sandi
              </ConfirmButton>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewUser({ customers }: { customers: Customer[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<CkbRole | "">("operator");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(fd: FormData) {
    if (!role) { setError("Pilih peran."); return; }
    setBusy(true); setError(null);
    const err = await createCkbUser({ name: String(fd.get("name") ?? ""), username: String(fd.get("username") ?? ""), password: String(fd.get("password") ?? ""), role, customers: picked });
    setBusy(false);
    if (err) setError(err); else { setOpen(false); setPicked([]); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4" />Akun CKB baru</Button></DialogTrigger>
      <DialogContent title="Akun CKB baru" description="Akun pribadi khusus CKB 3PL, tanpa akses Shell WMS.">
        <form action={submit} className="space-y-3">
          <div><Label htmlFor="nu-name">Nama</Label><Input id="nu-name" name="name" required minLength={2} /></div>
          <div><Label htmlFor="nu-user">Nama pengguna</Label><Input id="nu-user" name="username" required autoCapitalize="none" placeholder="huruf kecil, angka, . _ -" /></div>
          <div><Label htmlFor="nu-pw">Kata sandi</Label><Input id="nu-pw" name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" /></div>
          <RoleFields role={role} setRole={setRole} picked={picked} setPicked={setPicked} customers={customers} />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" disabled={busy}>{busy ? "Membuat…" : "Buat akun"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
