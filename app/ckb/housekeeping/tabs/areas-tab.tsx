"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RpcButton, callRpc } from "@/components/ckb/rpc-button";
import { Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { PASTE_MAX_ROWS, dateLabel, parsePaste } from "@/lib/ckb/housekeeping";
import { cn } from "@/lib/utils";

export type AreaRow = { id: string; code: string; name: string; kind: "RACK" | "MANUAL"; customer_id: string | null; active: boolean; note: string | null };
export type PicRow = { area_id: string; pic_user_id: string; pic_name: string; from_date: string };
export type Staff = { user_id: string; name: string; username: string; role: string };
export type Holiday = { holiday_date: string; reason: string };
export type Absence = { id: string; user_id: string; from_date: string; to_date: string; reason: string; recorded_name: string };
type Preview = { line: number; code: string | null; status: "OK" | "REFUSED"; message: string | null; create_new: boolean; has_customer: boolean; has_pic: boolean };

/** Racks and manual locations with their customer and PIC, bulk entry from Excel, holidays and leave. */
export function AreasClient({ areas, pics, customers, staff, holidays, absences, isAdmin, today }: {
  areas: AreaRow[]; pics: PicRow[]; customers: { id: string; name: string }[]; staff: Staff[]; holidays: Holiday[]; absences: Absence[]; isAdmin: boolean; today: string;
}) {
  const [q, setQ] = useState("");
  const [cust, setCust] = useState("");
  const [noPic, setNoPic] = useState(false);
  const [picFilter, setPicFilter] = useState("");
  const [open, setOpen] = useState<{ id: string; mode: "pic" | "edit" } | null>(null);
  const picOf = useMemo(() => new Map(pics.map((p) => [p.area_id, p])), [pics]);
  const cname = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  const shown = areas.filter((a) => (!q.trim() || `${a.code} ${a.name}`.toLowerCase().includes(q.trim().toLowerCase()))
    && (!cust || (cust === "none" ? !a.customer_id : a.customer_id === cust)) && (!noPic || !picOf.has(a.id)) && (!picFilter || picOf.get(a.id)?.pic_user_id === picFilter));
  const withoutPic = areas.filter((a) => a.active && !picOf.has(a.id)).length, withoutCustomer = areas.filter((a) => a.active && !a.customer_id).length;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1"><Label htmlFor="ar-q">Cari kode atau nama</Label><Input id="ar-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="mis. CG05" /></div>
          <div><Label htmlFor="ar-c">Customer</Label>
            <Select id="ar-c" value={cust} onChange={(e) => setCust(e.target.value)}>
              <option value="">Semua</option><option value="none">Belum ada customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select></div>
          <div><Label htmlFor="ar-p">PIC</Label>
            <Select id="ar-p" value={picFilter} onChange={(e) => setPicFilter(e.target.value)}>
              <option value="">Semua</option>{staff.map((x) => <option key={x.user_id} value={x.user_id}>{x.name}</option>)}
            </Select></div>
          <Button variant={noPic ? "default" : "outline"} onClick={() => setNoPic((v) => !v)}>Tanpa PIC · {withoutPic}</Button>
          {isAdmin && (
            <RpcButton rpc="ckb_hk_sync_racks" args={{}} title="Sinkron rak" confirmLabel="Sinkron" variant="outline"
              summary="Tambahkan rak CKB yang belum ada sebagai area. Area yang sudah ada tidak diubah: nama, customer dan PIC tetap.">Sinkron rak</RpcButton>
          )}
        </div>
        {(withoutPic > 0 || withoutCustomer > 0) && (
          <p className="text-sm text-warn">{withoutPic} area aktif belum punya PIC · {withoutCustomer} belum punya customer (area tanpa customer tidak bisa diisi housekeeping).</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-steel-100 bg-white">
          <Table>
            <thead><tr><Th>Kode</Th><Th>Nama</Th><Th>Jenis</Th><Th>Customer</Th><Th>PIC</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{shown.map((a) => {
              const p = picOf.get(a.id);
              const isOpen = open?.id === a.id;
              return (
                <Fragment key={a.id}>
                  <tr className={cn(!a.active && "opacity-50")}>
                    <Td><span className="font-cond text-lg font-bold">{a.code}</span></Td>
                    <Td className="text-sm">{a.name}</Td>
                    <Td><Pill tone={a.kind === "RACK" ? "info" : "neutral"}>{a.kind === "RACK" ? "Rak" : "Manual"}</Pill></Td>
                    <Td className="text-sm">{a.customer_id ? cname.get(a.customer_id) : <span className="text-warn">belum ada</span>}</Td>
                    <Td className="text-sm">{p ? <>{p.pic_name}<div className="text-xs text-steel-500">sejak {dateLabel(p.from_date)}</div></> : <span className="text-warn">belum ada</span>}</Td>
                    <Td>{a.active ? <Pill tone="ok">Aktif</Pill> : <Pill tone="muted">Nonaktif</Pill>}</Td>
                    <Td className="whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => setOpen(isOpen && open?.mode === "pic" ? null : { id: a.id, mode: "pic" })}>Ganti PIC</Button>{" "}
                      {isAdmin && <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen && open?.mode === "edit" ? null : { id: a.id, mode: "edit" })}>Ubah</Button>}
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={7} className="border-b border-steel-100 bg-paper p-3">
                      {open?.mode === "pic" ? <AssignForm area={a} current={p} staff={staff} today={today} onDone={() => setOpen(null)} />
                        : <EditForm area={a} customers={customers} onDone={() => setOpen(null)} />}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </Table>
          {shown.length === 0 && <p className="p-5 text-center text-sm text-steel-500">Tidak ada area untuk filter ini.</p>}
        </div>
        {isAdmin && <AddArea customers={customers} />}
      </section>

      <ImportPanel today={today} />
      <Calendar holidays={holidays} absences={absences} staff={staff} today={today} />
    </div>
  );
}

function useAct() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(rpc: string, args: Record<string, unknown>, done?: () => void) {
    setBusy(true); setError(null);
    const [, err] = await callRpc(rpc, args);
    setBusy(false);
    if (err) { setError(err); return; }
    done?.(); router.refresh();
  }
  return { error, busy, run, setError };
}

function AssignForm({ area, current, staff, today, onDone }: { area: AreaRow; current: PicRow | undefined; staff: Staff[]; today: string; onDone: () => void }) {
  const [pic, setPic] = useState(current?.pic_user_id ?? "");
  const [from, setFrom] = useState(today);
  const { error, busy, run } = useAct();
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">PIC {area.code}{current ? ` · sekarang ${current.pic_name} sejak ${dateLabel(current.from_date)}` : ""}</p>
      <div className="grid gap-2 md:grid-cols-[18rem_10rem_auto_auto] md:items-end">
        <div><Label htmlFor={`pic-${area.id}`}>PIC baru</Label>
          <Select id={`pic-${area.id}`} value={pic} onChange={(e) => setPic(e.target.value)}>
            <option value="">Tanpa PIC</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name} ({s.username})</option>)}
          </Select></div>
        <div><Label htmlFor={`pf-${area.id}`}>Berlaku mulai</Label><Input id={`pf-${area.id}`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <Button disabled={busy || (!pic && !current) || pic === (current?.pic_user_id ?? "")} onClick={() => void run("ckb_hk_assign", { p_area: area.id, p_pic: pic || null, p_from: from }, onDone)}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        <Button variant="ghost" onClick={onDone}>Batal</Button>
      </div>
      <p className="text-xs text-steel-500">PIC sebelumnya berakhir sehari sebelum tanggal berlaku; riwayatnya tetap tersimpan.</p>
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}

function EditForm({ area, customers, onDone }: { area: AreaRow; customers: { id: string; name: string }[]; onDone: () => void }) {
  const [name, setName] = useState(area.name);
  const [customer, setCustomer] = useState(area.customer_id ?? "");
  const [active, setActive] = useState(area.active);
  const [note, setNote] = useState(area.note ?? "");
  const { error, busy, run } = useAct();
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">Ubah {area.code}</p>
      <div className="grid gap-2 md:grid-cols-[16rem_14rem_1fr] md:items-end">
        <div><Label htmlFor={`en-${area.id}`}>Nama</Label><Input id={`en-${area.id}`} value={name} onChange={(e) => setName(e.target.value)} /><p className="mt-1 text-xs text-warn">Nama area terlihat oleh customer. Jangan menulis nama orang.</p></div>
        <div><Label htmlFor={`ec-${area.id}`}>Customer</Label>
          <Select id={`ec-${area.id}`} value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">Belum ada</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select></div>
        <div><Label htmlFor={`eo-${area.id}`}>Catatan</Label><Input id={`eo-${area.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Aktif (dapat diisi housekeeping)</label>
        <Button disabled={busy || name.trim().length < 2} onClick={() => void run("ckb_hk_save_area", { p_id: area.id, p_code: null, p_name: name, p_customer: customer || null, p_active: active, p_note: note }, onDone)}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        <Button variant="ghost" onClick={onDone}>Batal</Button>
      </div>
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}

function AddArea({ customers }: { customers: { id: string; name: string }[] }) {
  const [show, setShow] = useState(false);
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [customer, setCustomer] = useState("");
  const { error, busy, run } = useAct();
  if (!show) return <Button variant="outline" onClick={() => setShow(true)}>Tambah lokasi manual</Button>;
  return (
    <div className="space-y-2 rounded-lg border border-steel-100 bg-white p-3 text-sm">
      <p className="font-semibold">Lokasi manual</p>
      <p className="text-xs text-steel-500">Tempat selain rak: titik di lantai, dock, atau pojok customer. Kode 2-30 karakter (huruf, angka, spasi, - dan _).</p>
      <div className="grid gap-2 md:grid-cols-[10rem_1fr_14rem_auto_auto] md:items-end">
        <div><Label htmlFor="aa-code">Kode</Label><Input id="aa-code" className="uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="mis. DOCK-1" /></div>
        <div><Label htmlFor="aa-name">Nama</Label><Input id="aa-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Dock depan Freeport" /><p className="mt-1 text-xs text-warn">Nama area terlihat oleh customer. Jangan menulis nama orang.</p></div>
        <div><Label htmlFor="aa-cust">Customer</Label>
          <Select id="aa-cust" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">Belum ada</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select></div>
        <Button disabled={busy || code.trim().length < 2 || name.trim().length < 2} onClick={() => void run("ckb_hk_save_area", { p_id: null, p_code: code, p_name: name, p_customer: customer || null, p_active: true, p_note: null }, () => { setCode(""); setName(""); setCustomer(""); setShow(false); })}>{busy ? "Menyimpan…" : "Tambah"}</Button>
        <Button variant="ghost" onClick={() => setShow(false)}>Batal</Button>
      </div>
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}

/** Paste from Excel: kode, customer, username PIC (and optionally the name of a new location). Preview first; one refused row stops the file. */
function ImportPanel({ today }: { today: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [create, setCreate] = useState(false);
  const [from, setFrom] = useState(today);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [rows, setRows] = useState<ReturnType<typeof parsePaste>["rows"]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function check() {
    setMsg(null); setPreview(null);
    const p = parsePaste(text);
    if (p.error) { setMsg({ ok: false, text: p.error }); return; }
    setBusy(true);
    const [res, err] = await callRpc<Preview[]>("ckb_hk_import_preview", { p_rows: p.rows, p_create_missing: create });
    setBusy(false);
    if (err || !res) { setMsg({ ok: false, text: err ?? "Gagal." }); return; }
    setRows(p.rows); setPreview(res);
  }
  async function apply() {
    setBusy(true); setMsg(null);
    const [res, err] = await callRpc<{ created: number; customers_set: number; pics_set: number; unchanged: number }>("ckb_hk_import_apply", { p_rows: rows, p_create_missing: create, p_from: from });
    setBusy(false);
    if (err || !res) { setMsg({ ok: false, text: err ?? "Gagal." }); return; }
    setMsg({ ok: true, text: `Selesai: ${res.created} lokasi baru, ${res.customers_set} customer diisi, ${res.pics_set} PIC diatur, ${res.unchanged} tidak berubah.` });
    setPreview(null); setText("");
    router.refresh();
  }
  const bad = preview?.filter((r) => r.status === "REFUSED").length ?? 0;
  return (
    <section className="space-y-3">
      <h2 className="font-cond text-xl font-semibold">Impor dari Excel</h2>
      <p className="text-sm text-steel-500">Salin dari Excel lalu tempel: kolom <b>kode lokasi</b>, <b>customer</b> (kode atau nama), <b>username PIC</b>, dan boleh <b>nama lokasi</b> untuk lokasi baru. Baris yang hanya berisi kode tidak mengubah apa pun. Maksimal {PASTE_MAX_ROWS} baris.</p>
      <textarea aria-label="Tempel daftar dari Excel" className="h-40 w-full rounded-md border border-steel-300 bg-white p-2 font-mono text-sm" value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }}
        placeholder={"CG05\tFreeport\tandi\nCG06\tCGP\tbudi\nDOCK-1\tFreeport\tandi\tDock depan"} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={create} onChange={(e) => { setCreate(e.target.checked); setPreview(null); }} />Buat lokasi yang belum ada</label>
        <div><Label htmlFor="im-from">PIC berlaku mulai</Label><Input id="im-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <Button variant="outline" disabled={busy || !text.trim()} onClick={() => void check()}>{busy ? "Memeriksa…" : "Periksa"}</Button>
        {preview && <Button disabled={busy || bad > 0} onClick={() => void apply()}>{busy ? "Menyimpan…" : `Terapkan ${preview.length} baris`}</Button>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
      {preview && (
        <div className="overflow-x-auto rounded-lg border border-steel-100 bg-white">
          <Table>
            <thead><tr><Th>Baris</Th><Th>Kode</Th><Th>Hasil</Th><Th>Keterangan</Th></tr></thead>
            <tbody>{preview.map((r) => (
              <tr key={r.line} className={cn(r.status === "REFUSED" && "bg-bad/5")}>
                <Td className="tabular">{r.line}</Td><Td>{r.code ?? "–"}</Td>
                <Td><Pill tone={r.status === "OK" ? "ok" : "bad"}>{r.status === "OK" ? (r.create_new ? "Baru" : "Siap") : "Ditolak"}</Pill></Td>
                <Td className="text-sm">{r.message ?? [r.has_customer ? "customer diisi" : "", r.has_pic ? "PIC diatur" : ""].filter(Boolean).join(" · ")}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </div>
      )}
      {preview && bad > 0 && <p className="text-sm text-bad">{bad} baris ditolak: perbaiki daftarnya lalu periksa lagi. Satu baris yang ditolak menghentikan seluruh file.</p>}
    </section>
  );
}

function Calendar({ holidays, absences, staff, today }: { holidays: Holiday[]; absences: Absence[]; staff: Staff[]; today: string }) {
  const [hDate, setHDate] = useState(today); const [hReason, setHReason] = useState("");
  const [user, setUser] = useState(""); const [aFrom, setAFrom] = useState(today); const [aTo, setATo] = useState(today); const [aReason, setAReason] = useState("");
  const h = useAct(), a = useAct();
  const name = new Map(staff.map((s) => [s.user_id, s.name]));
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h2 className="font-cond text-xl font-semibold">Hari libur</h2>
        <p className="text-sm text-steel-500">Hari libur tidak dihitung sebagai terlewat. Senin sampai Jumat selain ini adalah hari kerja.</p>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <div><Label htmlFor="h-date">Tanggal</Label><Input id="h-date" type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} /></div>
          <div><Label htmlFor="h-reason">Alasan</Label><Input id="h-reason" value={hReason} onChange={(e) => setHReason(e.target.value)} placeholder="mis. cuti bersama" /></div>
          <Button disabled={h.busy || hReason.trim().length < 2} onClick={() => void h.run("ckb_hk_set_holiday", { p_date: hDate, p_reason: hReason, p_remove: false }, () => setHReason(""))}>Tambah</Button>
        </div>
        {h.error && <p role="alert" className="text-sm text-bad">{h.error}</p>}
        <ul className="space-y-1 text-sm">{holidays.map((x) => (
          <li key={x.holiday_date} className="flex items-center justify-between gap-2 rounded bg-white px-3 py-2 ring-1 ring-steel-100">
            <span><b>{dateLabel(x.holiday_date)}</b> · {x.reason}</span>
            <Button size="sm" variant="ghost" onClick={() => void h.run("ckb_hk_set_holiday", { p_date: x.holiday_date, p_reason: null, p_remove: true })}>Hapus</Button>
          </li>
        ))}{holidays.length === 0 && <li className="text-steel-500">Belum ada hari libur.</li>}</ul>
      </div>
      <div className="space-y-3">
        <h2 className="font-cond text-xl font-semibold">Cuti PIC</h2>
        <p className="text-sm text-steel-500">Hari cuti tidak dihitung terlewat untuk PIC itu, dan tidak terlihat oleh customer (hari itu tampil sebagai tidak dijadwalkan).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="a-user">PIC</Label>
            <Select id="a-user" value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Pilih…</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name} ({s.username})</option>)}
            </Select></div>
          <div><Label htmlFor="a-from">Dari</Label><Input id="a-from" type="date" value={aFrom} onChange={(e) => setAFrom(e.target.value)} /></div>
          <div><Label htmlFor="a-to">Sampai</Label><Input id="a-to" type="date" value={aTo} onChange={(e) => setATo(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="a-reason">Alasan</Label><Input id="a-reason" value={aReason} onChange={(e) => setAReason(e.target.value)} placeholder="mis. sakit, cuti tahunan" /></div>
        </div>
        <Button disabled={a.busy || !user || aReason.trim().length < 2} onClick={() => void a.run("ckb_hk_add_absence", { p_user: user, p_from: aFrom, p_to: aTo, p_reason: aReason }, () => setAReason(""))}>Catat cuti</Button>
        {a.error && <p role="alert" className="text-sm text-bad">{a.error}</p>}
        <ul className="space-y-1 text-sm">{absences.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 rounded bg-white px-3 py-2 ring-1 ring-steel-100">
            <span><b>{name.get(x.user_id) ?? "PIC"}</b> · {dateLabel(x.from_date)}{x.to_date !== x.from_date ? ` – ${dateLabel(x.to_date)}` : ""} · {x.reason}</span>
            <Button size="sm" variant="ghost" onClick={() => void a.run("ckb_hk_remove_absence", { p_id: x.id })}>Hapus</Button>
          </li>
        ))}{absences.length === 0 && <li className="text-steel-500">Belum ada cuti.</li>}</ul>
      </div>
    </section>
  );
}
