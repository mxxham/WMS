"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Filter, ChevronDown, ChevronUp, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Th, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { REBAG_STATUSES, type RebagStatus, isRebagDeletable } from "@/lib/ckb/rebagging";

/** Row shape from the summary view. */
export type RebaggingJobSummary = {
  id: string;
  job_no: string;
  job_date: string | null;
  shift: string;
  warehouse: string;
  customer: string | null;
  customer_ref: string | null;
  operation_type: "DAMAGE_REBAG" | "SPLIT" | "RELABEL" | "COMBINE";
  reason: string;
  priority: number;
  status: RebagStatus;
  creator_name: string;
  executor_name: string | null;
  verifier_name: string | null;
  approver_name: string | null;
  created_at: string;
  item_sku: string | null;
  item_description: string | null;
  sources_count: number;
  outputs_count: number;
  evidence_before_count: number;
  evidence_after_count: number;
  variance_qty: number | null;
  variance_reason: string | null;
};

const OPERATION_LABELS: Record<RebaggingJobSummary["operation_type"], string> = {
  DAMAGE_REBAG: "Rebag rusak",
  SPLIT: "Split / bagi",
  RELABEL: "Relabel",
  COMBINE: "Gabung / combine",
};

const STATUS_ORDER: RebagStatus[] = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "AWAITING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
  "REVERSED",
];

// Build status label map from REBAG_STATUSES
const STATUS_LABELS: Record<RebagStatus, string> = Object.fromEntries(
  REBAG_STATUSES.map((s) => [s.key, s.label])
) as Record<RebagStatus, string>;

const CUSTOMERS = ["Freeport", "CGP", "SIP", "MNE", "Boiler", "SSB"] as const;
const WAREHOUSES = ["Gudang A", "Gudang B"] as const;
const SHIFTS = ["Pagi", "Siang", "Malam"] as const;

function StatusBadge({ status }: { status: RebagStatus }) {
  const meta = REBAG_STATUSES.find((s) => s.key === status);
  const tone = meta?.tone ?? "steel-300";
  const label = meta?.label ?? status;
  if (tone.startsWith("steel-")) {
    return <Badge className={`bg-${tone} text-${tone === "steel-100" ? "steel-700" : "white"}`}>{label}</Badge>;
  }
  const toneColors: Record<string, string> = {
    ckb: "bg-ckb text-white",
    "ckb-dark": "bg-ckb-dark text-white",
    "ckb-tint": "bg-ckb-tint text-ckb",
    paper: "bg-paper text-steel-700",
    plate: "bg-plate text-steel-700",
    ok: "bg-ok text-white",
    warn: "bg-warn text-steel",
    bad: "bg-bad text-white",
  };
  return <Badge className={toneColors[tone] ?? "bg-steel-100 text-steel-700"}>{label}</Badge>;
}

function OperationBadge({ type }: { type: RebaggingJobSummary["operation_type"] }) {
  return <Badge className="bg-ckb/10 text-ckb">{OPERATION_LABELS[type]}</Badge>;
}

export function RebaggingList({ jobs, role }: { jobs: RebaggingJobSummary[]; role: "operator" | "supervisor" | "admin" }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [operationFilter, setOperationFilter] = useState<string>("all");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState(false);
  const [sortKey, setSortKey] = useState<keyof RebaggingJobSummary>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);

  const filteredJobs = useMemo(() => {
    let result = jobs;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (j) =>
          j.job_no.toLowerCase().includes(q) ||
          (j.item_sku?.toLowerCase().includes(q) ?? false) ||
          (j.customer_ref?.toLowerCase().includes(q) ?? false) ||
          (j.reason.toLowerCase().includes(q))
      );
    }

    if (statusFilter !== "all") result = result.filter((j) => j.status === statusFilter);
    if (operationFilter !== "all") result = result.filter((j) => j.operation_type === operationFilter);
    if (warehouseFilter !== "all") result = result.filter((j) => j.warehouse === warehouseFilter);
    if (dateFrom) result = result.filter((j) => j.job_date && j.job_date >= dateFrom);
    if (dateTo) result = result.filter((j) => j.job_date && j.job_date <= dateTo);
    if (assigneeFilter.trim()) {
      const q = assigneeFilter.trim().toLowerCase();
      result = result.filter(
        (j) =>
          (j.executor_name?.toLowerCase().includes(q) ?? false) ||
          (j.verifier_name?.toLowerCase().includes(q) ?? false) ||
          (j.approver_name?.toLowerCase().includes(q) ?? false)
      );
    }
    if (exceptionFilter) {
      result = result.filter((j) => j.variance_qty !== null && j.variance_qty !== 0);
    }

    result = [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === "asc" ? 1 : -1;
      if (bv == null) return sortDir === "asc" ? -1 : 1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [
    jobs,
    search,
    statusFilter,
    operationFilter,
    warehouseFilter,
    dateFrom,
    dateTo,
    assigneeFilter,
    exceptionFilter,
    sortKey,
    sortDir,
  ]);

  const handleSort = (key: keyof RebaggingJobSummary) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ sortKey: key }: { sortKey: keyof RebaggingJobSummary }) => {
    if (sortKey !== key) return <ChevronDown className="h-4 w-4 text-steel-300" />;
    return sortDir === "asc" ? <ChevronUp className="h-4 w-4 text-ckb" /> : <ChevronDown className="h-4 w-4 text-ckb" />;
  };

  const hasActiveFilters =
    statusFilter !== "all" ||
    operationFilter !== "all" ||
    warehouseFilter !== "all" ||
    dateFrom ||
    dateTo ||
    assigneeFilter ||
    exceptionFilter;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {/* Intro */}
      <p className="max-w-3xl text-sm text-steel-500">
        Daftar pekerjaan rebagging. Gunakan pencarian dan filter untuk menemukan pekerjaan.
        Klik nomor pekerjaan untuk membuka workspace.
      </p>

      {/* Toolbar */}
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-steel-500" />
                <Input
                  placeholder="Cari job_no, SKU, referensi, alasan…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={hasActiveFilters ? "default" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-4 w-4" /> Filter
              </Button>
            </div>
          </div>

          {showFilters && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 border-t border-steel-100 pt-4">
              <div>
                <Label htmlFor="f-status">Status</Label>
                <Select
                  id="f-status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full"
                >
                  <option value="all">Semua</option>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s] ?? s}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="f-op">Jenis operasi</Label>
                <Select
                  id="f-op"
                  value={operationFilter}
                  onChange={(e) => setOperationFilter(e.target.value)}
                  className="w-full"
                >
                  <option value="all">Semua</option>
                  <option value="DAMAGE_REBAG">Rebag rusak</option>
                  <option value="SPLIT">Split / bagi</option>
                  <option value="RELABEL">Relabel</option>
                  <option value="COMBINE">Gabung / combine</option>
                </Select>
              </div>

              <div>
                <Label htmlFor="f-wh">Gudang</Label>
                <Select
                  id="f-wh"
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  className="w-full"
                >
                  <option value="all">Semua</option>
                  {WAREHOUSES.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="f-assignee">Petugas (nama)</Label>
                <Input
                  id="f-assignee"
                  placeholder="Nama eksekutor/verifikator/pemberi persetujuan"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="f-date-from">Tanggal dari</Label>
                  <Input
                    id="f-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="f-date-to">Tanggal sampai</Label>
                  <Input
                    id="f-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer w-full">
                  <input
                    type="checkbox"
                    checked={exceptionFilter}
                    onChange={(e) => setExceptionFilter(e.target.checked)}
                    className="rounded border-steel-300 text-ckb focus:ring-ckb"
                  />
                  <span className="text-sm text-steel-700">Hanya yang ada varians (exception)</span>
                </label>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardContent className="pt-4">
          {filteredJobs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-steel-500">Tidak ada pekerjaan yang cocok.</p>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setStatusFilter("all"); setOperationFilter("all"); setWarehouseFilter("all"); setDateFrom(""); setDateTo(""); setAssigneeFilter(""); setExceptionFilter(false); }}>
                  Hapus filter
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table sticky>
                <thead>
                  <tr>
                    <Th onClick={() => handleSort("job_no")} className="cursor-pointer select-none">
                      Job No <SortIcon sortKey="job_no" />
                    </Th>
                    <Th onClick={() => handleSort("job_date")} className="cursor-pointer select-none whitespace-nowrap">
                      Tanggal <SortIcon sortKey="job_date" />
                    </Th>
                    <Th>Shift</Th>
                    <Th>Gudang</Th>
                    <Th>Pelanggan</Th>
                    <Th>Operasi</Th>
                    <Th onClick={() => handleSort("status")} className="cursor-pointer select-none">
                      Status <SortIcon sortKey="status" />
                    </Th>
                    <Th>Sumber</Th>
                    <Th>Output</Th>
                    <Th>Foto B/A</Th>
                    <Th onClick={() => handleSort("created_at")} className="cursor-pointer select-none">
                      Dibuat <SortIcon sortKey="created_at" />
                    </Th>
                    <Th>Oleh</Th>
                    <Th className="w-48">Aksi</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr key={job.id} className={cn(job.status === "OPEN" && "bg-plate/10", job.status === "IN_PROGRESS" && "bg-ckb/5")}>
                      <Td>
                        <a href={`/ckb/rebagging/${job.id}`} className="font-semibold underline text-ckb hover:text-ckb-dark">
                          {job.job_no}
                        </a>
                        {job.customer_ref && <div className="text-xs text-steel-500">Ref: {job.customer_ref}</div>}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {fmtDate(job.job_date)}
                        <div>{fmtDateTime(job.created_at)}</div>
                      </Td>
                      <Td className="text-xs whitespace-nowrap">{job.shift}</Td>
                      <Td className="text-xs">{job.warehouse}</Td>
                      <Td className="text-xs">{job.customer ?? "—"}</Td>
                      <Td><OperationBadge type={job.operation_type} /></Td>
                      <Td><StatusBadge status={job.status} /></Td>
                      <Td className="text-right tabular">{fmtNum(job.sources_count)}</Td>
                      <Td className="text-right tabular">{fmtNum(job.outputs_count)}</Td>
                      <Td className="text-center text-xs">
                        {job.evidence_before_count > 0 || job.evidence_after_count > 0 ? (
                          <>
                            <span className="text-ok">●</span>{" "}
                            <span className="text-ckb">●</span>
                          </>
                        ) : (
                          <span className="text-steel-300">—</span>
                        )}
                        <div className="text-[10px] text-steel-500">
                          {job.evidence_before_count} / {job.evidence_after_count}
                        </div>
                      </Td>
                      <Td className="text-xs">{fmtDateTime(job.created_at)}</Td>
                      <Td className="text-xs">
                        {job.creator_name}
                        {job.executor_name && <div>→ {job.executor_name}</div>}
                        {job.verifier_name && <div>→ {job.verifier_name}</div>}
                        {job.approver_name && <div>→ {job.approver_name}</div>}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <a href={`/ckb/rebagging/${job.id}`}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </a>
                          {job.variance_qty !== null && job.variance_qty !== 0 && (
                            <span className="rounded-plate bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn" title={`Varians: ${fmtNum(Number(job.variance_qty))}`}>
                              Varians
                            </span>
                          )}
                          {role === "admin" && isRebagDeletable({ posted_at: null, status: job.status }) && (
                            <DeleteJobButton job={job} />
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <CreateJobDialog role={role} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Delete Job Button (admin only, never-posted jobs)                  */
/* ------------------------------------------------------------------ */

function DeleteJobButton({ job }: { job: RebaggingJobSummary }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    if (person.trim().length < 2) return setError("Nama petugas minimal 2 karakter.");
    setBusy(true);
    try {
      const { error: rpcError } = await createClient().rpc("delete_rebagging_job", {
        p_job_id: job.id,
        p_reason: null,
        p_by_name: person.trim(),
      });
      setBusy(false);
      if (rpcError) return setError(rpcError.message);
      router.refresh();
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  }

  const statusMeta = REBAG_STATUSES.find((s) => s.key === job.status);
  const statusLabel = statusMeta?.label ?? job.status;

  return (
    <ConfirmButton
      title="Hapus pekerjaan rebagging"
      summary={`${job.job_no} (${statusLabel}) dihapus permanen beserta baris sumber/output/bukti foto/riwayatnya. Tidak ada mutasi stok — pekerjaan ini belum pernah diposting.`}
      confirmLabel="Hapus"
      onConfirm={async () => { await handleDelete(); return null; }}
      disabled={busy}
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0 text-bad hover:bg-bad/10"
      aria-label={`Hapus pekerjaan ${job.job_no}`}
    >
      <span className="text-[10px]">🗑</span>
    </ConfirmButton>
  );
}

/* ------------------------------------------------------------------ */
/* Create Job Dialog                                                    */
/* ------------------------------------------------------------------ */

function CreateJobDialog({ role }: { role: "operator" | "supervisor" | "admin" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [person, setPerson] = usePersonName();

  const [operationType, setOperationType] = useState<RebaggingJobSummary["operation_type"]>("DAMAGE_REBAG");
  const [reason, setReason] = useState("");
  const [warehouse, setWarehouse] = useState<string>(WAREHOUSES[0]);
  const [customer, setCustomer] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [shift, setShift] = useState<string>(SHIFTS[0]);
  const [priority, setPriority] = useState(0);
  const [note, setNote] = useState("");

  function setCreateOpen(v: boolean) {
    setOpen(v);
    if (!v) {
      setError(null);
      setOperationType("DAMAGE_REBAG");
      setReason("");
      setWarehouse(WAREHOUSES[0]);
      setCustomer("");
      setCustomerRef("");
      setShift(SHIFTS[0]);
      setPriority(0);
      setNote("");
    }
  }

  async function submit() {
    setError(null);
    if (!reason.trim()) return setError("Alasan pekerjaan wajib diisi.");
    if (person.trim().length < 2) return setError("Nama pelaksana minimal 2 karakter.");
    setBusy(true);
    try {
      const { data, error: rpcError } = await createClient().rpc("create_rebagging_job", {
        p_operation_type: operationType,
        p_reason: reason.trim(),
        p_warehouse: warehouse,
        p_customer: customer || null,
        p_customer_ref: customerRef.trim() || null,
        p_shift: shift,
        p_priority: priority,
        p_note: note.trim() || null,
        p_by_name: person.trim(),
      });
      setBusy(false);
      if (rpcError) return setError(rpcError.message);
      setCreateOpen(false);
      router.push(`/ckb/rebagging/${data}`);
      router.refresh();
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setCreateOpen}>
      <DialogTrigger asChild>
        <Button variant="accent" size="lg" disabled={busy}>
          <Plus className="h-4 w-4" /> Buat pekerjaan
        </Button>
      </DialogTrigger>
      <DialogContent title="Buat pekerjaan rebagging" description="Isi identitas pekerjaan. Baris sumber dan output diisi di halaman detail.">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Jenis operasi <span className="text-bad">*</span></Label>
              <Select value={operationType} onChange={(e) => setOperationType(e.target.value as RebaggingJobSummary["operation_type"])} required>
                <option value="DAMAGE_REBAG">Rebag rusak (ganti kemasan rusak)</option>
                <option value="SPLIT">Split / bagi (satu sumber → banyak output)</option>
                <option value="RELABEL">Relabel (ganti label/kemasan, stok sama)</option>
                <option value="COMBINE">Gabung / combine (banyak sumber → satu output)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Gudang <span className="text-bad">*</span></Label>
              <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required>
                {WAREHOUSES.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Pelanggan (aliran)</Label>
              <Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
                <option value="">— Pilih aliran —</option>
                {CUSTOMERS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Shift <span className="text-bad">*</span></Label>
              <Select value={shift} onChange={(e) => setShift(e.target.value)} required>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Referensi customer (WO / DO kertas)</Label>
              <Input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} placeholder="Nomor WO / DO / dokumen pelanggan" />
            </div>
            <div className="space-y-1.5">
              <Label>Prioritas</Label>
              <Input
                type="number"
                min="0"
                max="99"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
                className="w-24"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Alasan pekerjaan <span className="text-bad">*</span></Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan mengapa rebagging ini dilakukan (contoh: kemasan robek, label salah, split untuk order kecil, dll.)"
              className="flex min-h-[80px] w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm placeholder:text-steel-500 resize-none"
              rows={3}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Catatan tambahan</Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opsional"
              className="flex min-h-[60px] w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm placeholder:text-steel-500 resize-none"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Nama pelaksana <span className="text-bad">*</span></Label>
            <PersonNameField id="creator-name" value={person} onChange={setPerson} />
            <p className="text-xs text-steel-500">Nama ini dicatat sebagai pembuat. Di halaman detail bisa diganti eksekutor/verifikator/pemberi persetujuan.</p>
          </div>

          {error && <p role="alert" className="text-sm text-bad">{error}</p>}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" size="lg" onClick={() => setCreateOpen(false)} disabled={busy}>Batal</Button>
            <ConfirmButton
              title="Buat pekerjaan rebagging"
              summary={`Akan dibuat pekerjaan "${OPERATION_LABELS[operationType]}" dengan alasan: "${reason.slice(0, 80)}${reason.length > 80 ? "…" : ""}". Nomor job (RBxxxxxx) digenerate otomatis.`}
              confirmLabel="Buat"
              onConfirm={async () => { await submit(); return null; }}
              disabled={busy}
            >
              {busy ? "Membuat…" : "Buat pekerjaan"}
            </ConfirmButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}