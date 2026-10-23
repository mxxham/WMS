"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Th, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ArrowRight, Camera, Clock, Minus, Plus } from "lucide-react";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { EvidenceUpload, EvidenceImage } from "./evidence-upload";
import {
  REBAG_STATUSES,
  REBAG_ACTIONS_BY_STATUS,
  OPERATION_TYPES,
  EVIDENCE_KIND_LABELS,
  computeVariance,
  allocatePreview,
  isRebagDeletable,
  type RebagStatus,
  type EvidenceKind,
} from "@/lib/ckb/rebagging";

// ---------------------------------------------------------------------------
// Row shapes (server-side joins done in page.tsx)
// ---------------------------------------------------------------------------

export type WorkspaceJob = {
  id: string;
  job_no: string;
  job_date: string;
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
  note: string | null;
  item_id: string | null;
  batch_lot: string;
  expiry_date: string | null;
  unit: string | null;
  actual_inputs: Array<{ line_no: number; quantity: number; unit?: string; pkg_count?: number }> | null;
  actual_outputs: Array<{ line_no: number; quantity: number; unit?: string; pkg_count?: number }> | null;
  checklist: Array<{ item: string; label: string; ok: boolean }> | null;
  input_qty: number | null;
  output_qty: number | null;
  variance_qty: number | null;
  variance_reason: string | null;
  variance_note: string | null;
  variance_decided_by: string | null;
  variance_decided_at: string | null;
  posted_ref: string | null;
  posted_at: string | null;
  reversal_note: string | null;
  reversed_by: string | null;
  reversed_at: string | null;
  last_post_error: string | null;
  created_at: string;
  updated_at: string;
  items?: { sku: string; description: string; uom: string } | null;
};

type SourceRow = {
  id: string;
  line_no: number;
  source_type: "STOCK" | "PACKAGE";
  bin_id: string | null;
  quantity: number;
  unit: string;
  pkg_count: number | null;
  gross_weight: number | null;
  net_weight: number | null;
  weight_unit: string | null;
  start_qty: number | null;
  bins?: { bin_code: string } | null;
  ckb_packages?: { package_no: string } | null;
};

type OutputRow = {
  id: string;
  line_no: number;
  to_bin_id: string | null;
  quantity: number;
  unit: string;
  pkg_count: number | null;
  bins?: { bin_code: string } | null;
};

type EvidenceRow = {
  id: string;
  kind: EvidenceKind;
  storage_path: string;
  mime: string;
  size_bytes: number;
  note: string | null;
  uploader_name: string;
  uploaded_at: string;
};

type EventRow = {
  id: string;
  event_type: string;
  by_name: string | null;
  note: string | null;
  at: string;
};

export interface RebaggingWorkspaceClientProps {
  userRole: "operator" | "supervisor" | "admin";
  userName: string;
  userShared: boolean;
  job: WorkspaceJob;
  sources: SourceRow[];
  outputs: OutputRow[];
  evidence: EvidenceRow[];
  events: EventRow[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const TONE_CLASSES: Record<string, string> = {
  ckb: "bg-ckb text-white",
  "ckb-dark": "bg-ckb-dark text-white",
  "ckb-tint": "bg-ckb-tint text-ckb-dark border border-ckb-dark/20",
  paper: "bg-paper text-ink",
  plate: "bg-plate text-ink",
  ok: "bg-ok/15 text-ok border border-ok/30",
  warn: "bg-warn/15 text-warn border border-warn/30",
  bad: "bg-bad/10 text-bad border border-bad/30",
  "steel-100": "bg-steel-100 text-ink",
  "steel-300": "bg-steel-300 text-ink",
  "steel-500": "bg-steel-500 text-white",
  "steel-700": "bg-steel-700 text-white",
};

function StatusBadge({ status }: { status: RebagStatus }) {
  const meta = REBAG_STATUSES.find((s) => s.key === status);
  return (
    <Badge className={TONE_CLASSES[meta?.tone ?? "steel-300"] ?? ""}>{meta?.label ?? status}</Badge>
  );
}

const samePerson = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() !== "" && (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const isSupervisor = (role: string) => role === "supervisor" || role === "admin";

const EVENT_LABELS: Record<string, string> = {
  CREATE: "Pekerjaan dibuat",
  UPDATE: "Pekerjaan diubah",
  OPEN: "Pekerjaan dibuka",
  START: "Eksekusi dimulai (stok di-hold)",
  RECORD: "Eksekusi direkam",
  SUBMIT: "Diserahkan untuk verifikasi",
  VERIFY: "Diverifikasi",
  REJECT: "Ditolak verifikator",
  VARIANCE: "Varians diselesaikan",
  HOLD: "Ditahan",
  UNHOLD: "Hold dilepas",
  POST: "Diposting ke stok utama",
  REVERSE: "Posting dibalik",
  CANCEL: "Dibatalkan",
  EVIDENCE: "Bukti foto ditambah",
};

const VARIANCE_REASONS: Array<{ key: string; label: string }> = [
  { key: "COUNT_VARIANCE", label: "Selisih hitung" },
  { key: "DAMAGED", label: "Rusak" },
  { key: "EXPIRED", label: "Kedaluwarsa" },
  { key: "DATA_ENTRY", label: "Salah input data" },
  { key: "MISPICK", label: "Salah ambil (mispick)" },
  { key: "FOUND", label: "Ditemukan lebih" },
  { key: "LOST", label: "Hilang" },
  { key: "RECEIVING_DIFF", label: "Selisih penerimaan" },
  { key: "RETURN", label: "Retur" },
  { key: "OPENING", label: "Koreksi saldo awal" },
  { key: "OTHER", label: "Lainnya" },
  { key: "PICK_AUDIT", label: "Audit picks" },
];

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function RebaggingWorkspaceClient(props: RebaggingWorkspaceClientProps) {
  return <WorkspaceInner key={`${props.job.id}:${props.job.updated_at}`} {...props} />;
}

function WorkspaceInner({ userRole, userShared, job, sources, outputs, evidence, events }: RebaggingWorkspaceClientProps) {
  const router = useRouter();
  const [personName, setPersonName] = usePersonName();

  const can = REBAG_ACTIONS_BY_STATUS[job.status] ?? [];
  const supervisor = isSupervisor(userRole);
  const opMeta = OPERATION_TYPES.find((t) => t.key === job.operation_type);

  /** Run one RPC; return an error message or null on success. Refreshes server data. */
  async function rpc(name: string, args: Record<string, unknown>): Promise<string | null> {
    const byName = personName.trim();
    if (byName.length < 2) return "Nama petugas minimal 2 karakter.";
    const { error } = await createClient().rpc(name, { ...args, p_by_name: byName });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  const act = (name: string, args: Record<string, unknown> = {}) => () => rpc(name, args);

  return (
    <div className="space-y-4">
      <PageHeader title={`Rebag ${job.job_no}`} live={["ckb_rebagging_jobs", "ckb_rebagging_sources", "ckb_rebagging_outputs", "ckb_rebagging_evidence", "ckb_rebagging_events"]} />

      <JobCard job={job} opMeta={opMeta?.label ?? job.operation_type} />
      <VarianceBanner job={job} />

      {/* Person name — every step records it */}
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <PersonNameField value={personName} onChange={setPersonName} label="Nama Anda" id="rebag-person" />
          <p className="text-sm text-steel-500">
            {userShared ? "Nama diketik per perangkat." : "Diambil dari akun Anda; boleh diisi ulang."}
          </p>
        </CardContent>
      </Card>

      <SourcesCard job={job} sources={sources} editable={can.includes("edit-sources")} byName={personName} />
      <OutputsCard job={job} outputs={outputs} sources={sources} editable={can.includes("edit-outputs")} byName={personName} />

      {/* Lifecycle actions */}
      <Card>
        <CardHeader><CardTitle>Aksi</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {can.includes("edit-sources") && job.status === "DRAFT" && (
            <ConfirmButton
              title="Buka pekerjaan"
              summary={`Pekerjaan ${job.job_no} berpindah ke status Terbuka. Baris sumber dan output terkunci untuk diubah.`}
              confirmLabel="Buka"
              onConfirm={act("open_rebagging_job", { p_job_id: job.id })}
            >
              <ArrowRight className="h-4 w-4" /> Buka pekerjaan
            </ConfirmButton>
          )}
          {job.status === "OPEN" && (
            <ConfirmButton
              title="Mulai eksekusi"
              summary={`Stok di bin sumber (${sources.map((s) => s.bins?.bin_code ?? "?").join(", ") || "—"}) ditahan sebesar rencana sumber. Picking lain tidak bisa mengambil stok yang ditahan sampai pekerjaan selesai.`}
              confirmLabel="Mulai"
              onConfirm={act("start_rebagging_execution", { p_job_id: job.id })}
            >
              Mulai eksekusi
            </ConfirmButton>
          )}
          {can.includes("record") && <ExecutionCard job={job} sources={sources} outputs={outputs} byName={personName} />}
          {job.status === "IN_PROGRESS" && (
            <ConfirmButton
              title="Serahkan untuk verifikasi"
              summary={`Total input ${fmtNum(job.input_qty)} → output ${fmtNum(job.output_qty)}. Foto sebelum/sesudah wajib sudah diunggah. Verifikator harus orang lain.`}
              confirmLabel="Serahkan"
              onConfirm={act("submit_rebagging_verification", { p_job_id: job.id })}
            >
              Serahkan verifikasi
            </ConfirmButton>
          )}
          {job.status === "AWAITING_VERIFICATION" && <VerificationCard job={job} personName={personName} onName={setPersonName} />}
          {job.status === "VERIFIED" && supervisor && (
            <ConfirmButton
              title="Posting ke stok utama"
              summary={postingSummary(job, sources, outputs)}
              confirmLabel="Posting"
              onConfirm={act("approve_post_rebagging", { p_job_id: job.id, p_note: `Posting ${job.job_no}` })}
            >
              Posting ke stok utama
            </ConfirmButton>
          )}
          {job.status === "VERIFIED" && !supervisor && (
            <p className="text-sm text-steel-500">Menunggu supervisor/admin me-posting.</p>
          )}
          {job.status === "COMPLETED" && supervisor && (
            <ConfirmButton
              title="Balikkan posting"
              summary={`Stok dikembalikan ke bin sumber, paket keluar non-aktif, riwayat dipertahankan. Pekerjaan ${job.job_no} jadi "Dibalik".`}
              confirmLabel="Balikkan"
              onConfirm={act("reverse_rebagging_posting", { p_job_id: job.id, p_note: `Pembalikan ${job.job_no}` })}
            >
              Balikkan posting
            </ConfirmButton>
          )}
          {(supervisor && can.includes("hold")) && (
            <ConfirmButton
              title="Tahan pekerjaan"
              summary={`Pekerjaan ${job.job_no} ditahan. Status sebelumnya tersimpan dan dapat dilepas kapan saja.`}
              confirmLabel="Tahan"
              onConfirm={act("toggle_rebagging_hold", { p_job_id: job.id, p_note: `Hold ${job.job_no}` })}
            >
              Tahan
            </ConfirmButton>
          )}
          {supervisor && job.status === "ON_HOLD" && (
            <ConfirmButton
              title="Lepas tahan"
              summary={`Hold pekerjaan ${job.job_no} dilepas.`}
              confirmLabel="Lepas"
              onConfirm={act("toggle_rebagging_hold", { p_job_id: job.id, p_note: `Unhold ${job.job_no}` })}
            >
              Lepas tahan
            </ConfirmButton>
          )}
          {supervisor && (can.includes("cancel")) && (
            <ConfirmButton
              title="Batalkan pekerjaan"
              summary={`Pekerjaan ${job.job_no} dibatalkan; hold dilepas, status tidak dapat kembali.`}
              confirmLabel="Batalkan"
              onConfirm={act("cancel_rebagging", { p_job_id: job.id, p_note: `Dibatalkan` })}
            >
              Batalkan
            </ConfirmButton>
          )}
          {userRole === "admin" && isRebagDeletable({ posted_at: job.posted_at, status: job.status }) && (
            <ConfirmButton
              title="Hapus pekerjaan"
              summary={`Pekerjaan ${job.job_no} (${REBAG_STATUSES.find(s => s.key === job.status)?.label ?? job.status}) dihapus permanen beserta baris sumber/output/bukti foto/riwayatnya. Tidak ada mutasi stok — pekerjaan ini belum pernah diposting.`}
              confirmLabel="Hapus"
              onConfirm={async () => {
                const err = await rpc("delete_rebagging_job", { p_job_id: job.id, p_reason: null });
                if (err) return err;
                router.push("/ckb/rebagging");
                router.refresh();
                return null;
              }}
              variant="ghost"
              size="sm"
              className="text-bad hover:bg-bad/10"
            >
              Hapus pekerjaan
            </ConfirmButton>
          )}
          {job.last_post_error && (
            <p className="w-full text-sm text-bad">Kesalahan posting terakhir: {job.last_post_error}</p>
          )}
        </CardContent>
      </Card>

      <EvidenceCard job={job} evidence={evidence} canAdd={can.includes("add-evidence")} byName={personName} />

      {computeVariance(job.input_qty ?? 0, job.output_qty ?? 0) !== 0 && !job.variance_reason &&
        !(["COMPLETED", "CANCELLED", "REVERSED"] as RebagStatus[]).includes(job.status) && supervisor && (
          <VarianceResolveCard job={job} />
        )}

      <TimelineCard events={events} job={job} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function JobCard({ job, opMeta }: { job: WorkspaceJob; opMeta: string }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={job.status} />
          <Badge className="bg-steel-100">{opMeta}</Badge>
          <Badge className="bg-steel-100">Pri {job.priority}</Badge>
          <span className="text-sm text-steel-500">{job.warehouse} · Shift {job.shift} · {fmtDate(job.job_date)}</span>
        </div>
        <p className="text-base">{job.reason}</p>
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          <Detail label="Produk" value={job.items ? `${job.items.sku} — ${job.items.description}` : "—"} />
          <Detail label="Batch / kedaluwarsa" value={job.expiry_date ? `${job.batch_lot || "—"} · ${fmtDate(job.expiry_date)}` : job.batch_lot || "—"} />
          <Detail label="Belanja / pelanggan" value={[job.customer, job.customer_ref].filter(Boolean).join(" · ") || "—"} />
          <Detail label="Satuan" value={job.unit ?? "—"} />
          <Detail label="Pembuat" value={job.creator_name} />
          <Detail label="Eksekutor" value={job.executor_name ?? "—"} />
          <Detail label="Verifikator" value={job.verifier_name ?? "—"} />
          <Detail label="Pemberi persetujuan" value={job.approver_name ?? "—"} />
          {job.posted_ref && <Detail label="Diposting" value={`${job.posted_ref} · ${fmtDateTime(job.posted_at)}`} />}
          {job.reversed_by && <Detail label="Dibalik oleh" value={`${job.reversed_by} · ${fmtDateTime(job.reversed_at)}`} />}
        </dl>
        {job.note && <p className="rounded-md bg-plate/30 p-3 text-sm">{job.note}</p>}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-steel-500">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function VarianceBanner({ job }: { job: WorkspaceJob }) {
  const variance = computeVariance(job.input_qty ?? 0, job.output_qty ?? 0);
  if (variance === 0 || job.input_qty === null) return null;
  return (
    <p className={cn("flex items-start gap-2 rounded-md p-3 text-sm", variance !== 0 && !job.variance_reason ? "bg-bad/10 text-bad border border-bad/30" : "bg-warn/15 text-warn border border-warn/30")}>
      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>
        Selisih <strong>{fmtNum(variance)}</strong> {job.unit ?? ""} (input {fmtNum(job.input_qty)} → output {fmtNum(job.output_qty)}).
        {job.variance_reason
          ? ` Alasan: ${VARIANCE_REASONS.find((r) => r.key === job.variance_reason)?.label ?? job.variance_reason} — ${job.variance_note ?? ""} (${job.variance_decided_by ?? "—"}).`
          : " Posting diblokir sampai supervisor menetapkan alasannya."}
      </span>
    </p>
  );
}

// --- Sources -----------------------------------------------------------------

type SourceDraft = {
  source_type: "STOCK" | "PACKAGE";
  bin_code: string;
  package_no: string;
  sku: string;
  batch_lot: string;
  expiry_date: string;
  quantity: string;
  unit: string;
  pkg_count: string;
};

function draftFromSource(s: SourceRow): SourceDraft {
  return {
    source_type: s.source_type,
    bin_code: s.bins?.bin_code ?? "",
    package_no: s.ckb_packages?.package_no ?? "",
    sku: "", batch_lot: "", expiry_date: "",
    quantity: String(s.quantity),
    unit: s.unit,
    pkg_count: s.pkg_count != null ? String(s.pkg_count) : "",
  };
}

function SourcesCard({ job, sources, editable, byName }: {
  job: WorkspaceJob; sources: SourceRow[]; editable: boolean; byName: string;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<SourceDraft[]>(sources.map(draftFromSource));
  const [error, setError] = useState<string | null>(null);

  function patch(i: number, p: Partial<SourceDraft>) {
    setDrafts((d) => d.map((row, j) => (j === i ? { ...row, ...p } : row)));
  }

  async function save(): Promise<string | null> {
    if (byName.trim().length < 2) return "Nama petugas minimal 2 karakter.";
    const lines = drafts.map((d) => {
      const line: Record<string, unknown> = {
        source_type: d.source_type,
        quantity: Number(d.quantity),
        unit: d.unit.trim(),
      };
      if (d.source_type === "PACKAGE") line.package_no = d.package_no.trim();
      else line.bin_code = d.bin_code.trim();
      if (d.sku.trim()) line.sku = d.sku.trim();
      if (d.batch_lot.trim()) line.batch_lot = d.batch_lot.trim();
      if (d.expiry_date.trim()) line.expiry_date = d.expiry_date.trim();
      if (d.pkg_count.trim()) line.pkg_count = Number(d.pkg_count);
      return line;
    });
    const { error } = await createClient().rpc("set_rebagging_sources", {
      p_job_id: job.id, p_lines: lines, p_by_name: byName.trim(),
    });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Baris sumber ({sources.length})</CardTitle>
        {sources.some((s) => s.start_qty != null) && (
          <Badge className="bg-ckb-tint text-ckb-dark border border-ckb-dark/20" title="Kuantitas identitas saat eksekusi dimulai">
            Stok awal tercatat
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}

        {editable && (
          <div className="space-y-3">
            {drafts.map((d, i) => (
              <div key={i} className="rounded-lg border border-steel-100 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Select value={d.source_type} onChange={(e) => patch(i, { source_type: e.target.value as SourceDraft["source_type"] })} className="w-auto">
                    <option value="STOCK">Ambil stok bin</option>
                    <option value="PACKAGE">Pakai paket</option>
                  </Select>
                  {d.source_type === "STOCK" ? (
                    <Input value={d.bin_code} onChange={(e) => patch(i, { bin_code: e.target.value.toUpperCase() })} placeholder="Kode bin, cth CA01A01" />
                  ) : (
                    <Input value={d.package_no} onChange={(e) => patch(i, { package_no: e.target.value.toUpperCase() })} placeholder="No. paket, cth PKG000001" />
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))} aria-label="Hapus baris">
                    <Minus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  {d.source_type === "STOCK" && (
                    <>
                      <Input value={d.sku} onChange={(e) => patch(i, { sku: e.target.value })} placeholder="SKU (opsional)" aria-label="SKU" />
                      <Input value={d.batch_lot} onChange={(e) => patch(i, { batch_lot: e.target.value })} placeholder="Batch (opsional)" aria-label="Batch" />
                      <Input type="date" value={d.expiry_date} onChange={(e) => patch(i, { expiry_date: e.target.value })} aria-label="Kedaluwarsa" />
                    </>
                  )}
                  <Input inputMode="decimal" value={d.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} placeholder="Kuantitas" aria-label="Kuantitas" required />
                  <Input value={d.unit} onChange={(e) => patch(i, { unit: e.target.value.toUpperCase() })} placeholder="SAT" aria-label="Satuan" required />
                  <Input inputMode="numeric" value={d.pkg_count} onChange={(e) => patch(i, { pkg_count: e.target.value })} placeholder="Jml paket (ops.)" aria-label="Jumlah paket" />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDrafts((ds) => [...ds, { source_type: "STOCK", bin_code: "", package_no: "", sku: "", batch_lot: "", expiry_date: "", quantity: "", unit: job.unit ?? "CAR", pkg_count: "" }])}>
                <Plus className="h-4 w-4" /> Tambah baris
              </Button>
              {(sources.length > 0 || drafts.length > 0) && (
                <ConfirmButton title="Simpan baris sumber" summary={`Daftar sumber ${job.job_no} diganti seluruhnya dengan ${drafts.length} baris.`} onConfirm={save}>
                  Simpan baris sumber
                </ConfirmButton>
              )}
            </div>
            <p className="text-xs text-steel-500">
              Bin dengan satu identitas stok cukup kode bin-nya; bin dengan beberapa identitas wajib mengisi
              hint (SKU/batch/kedaluwarsa) agar baris menunjuk satu baris stok yang tepat.
            </p>
          </div>
        )}

        {!editable && (
          <Table className="text-sm">
            <thead><tr><Th>#</Th><Th>Tipe</Th><Th>Bin / paket</Th><Th className="text-right">Qty</Th><Th>Sat</Th><Th>Paket</Th><Th>Stok awal</Th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <Td>{s.line_no}</Td>
                  <Td>{s.source_type === "PACKAGE" ? "Paket" : "Stok"}</Td>
                  <Td>{s.source_type === "PACKAGE" ? (s.ckb_packages?.package_no ?? "—") : (s.bins?.bin_code ?? "—")}</Td>
                  <Td className="text-right tabular">{fmtNum(s.quantity)}</Td>
                  <Td>{s.unit}</Td>
                  <Td>{s.pkg_count ?? "—"}</Td>
                  <Td>{s.start_qty != null ? fmtNum(s.start_qty) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --- Outputs ----------------------------------------------------------------

type OutputDraft = { bin_code: string; quantity: string; unit: string; pkg_count: string };

function OutputsCard({ job, outputs, sources, editable, byName }: {
  job: WorkspaceJob; outputs: OutputRow[]; sources: SourceRow[]; editable: boolean; byName: string;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<OutputDraft[]>(
    outputs.map((o) => ({ bin_code: o.bins?.bin_code ?? "", quantity: String(o.quantity), unit: o.unit, pkg_count: o.pkg_count != null ? String(o.pkg_count) : "" }))
  );
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<string | null> {
    if (byName.trim().length < 2) return "Nama petugas minimal 2 karakter.";
    const lines = drafts.map((d) => {
      const line: Record<string, unknown> = {
        bin_code: d.bin_code.trim(),
        quantity: Number(d.quantity),
        unit: d.unit.trim(),
      };
      if (d.pkg_count.trim()) line.pkg_count = Number(d.pkg_count);
      return line;
    });
    const { error } = await createClient().rpc("set_rebagging_outputs", {
      p_job_id: job.id, p_lines: lines, p_by_name: byName.trim(),
    });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  const preview = sources.length > 0 && drafts.length > 0 && drafts.every((d) => d.bin_code.trim() && Number(d.quantity) > 0)
    ? allocatePreview(
        sources.map((s) => ({ lineNo: s.line_no, quantity: Number(s.quantity), binCode: s.bins?.bin_code ?? "-" })),
        drafts.map((d, i) => ({ lineNo: i + 1, quantity: Number(d.quantity), binCode: d.bin_code.trim() }))
      )
    : null;

  return (
    <Card>
      <CardHeader><CardTitle>Rencana output ({outputs.length})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {editable && (
          <div className="space-y-3">
            {drafts.map((d, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-5 rounded-lg border border-steel-100 p-3 items-center">
                <Input value={d.bin_code} onChange={(e) => setDrafts((ds) => ds.map((row, j) => (j === i ? { ...row, bin_code: e.target.value.toUpperCase() } : row)))} placeholder="Kode bin tujuan" aria-label="Bin tujuan" />
                <Input inputMode="decimal" value={d.quantity} onChange={(e) => setDrafts((ds) => ds.map((row, j) => (j === i ? { ...row, quantity: e.target.value } : row)))} placeholder="Kuantitas" aria-label="Kuantitas output" required />
                <Input value={d.unit} onChange={(e) => setDrafts((ds) => ds.map((row, j) => (j === i ? { ...row, unit: e.target.value.toUpperCase() } : row)))} placeholder="SAT" aria-label="Satuan output" required />
                <Input inputMode="numeric" value={d.pkg_count} onChange={(e) => setDrafts((ds) => ds.map((row, j) => (j === i ? { ...row, pkg_count: e.target.value } : row)))} placeholder="Jml paket (ops.)" aria-label="Jumlah paket output" />
                <Button variant="ghost" size="icon" onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))} aria-label="Hapus baris output">
                  <Minus className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDrafts((ds) => [...ds, { bin_code: "", quantity: "", unit: job.unit ?? "CAR", pkg_count: "" }])}>
                <Plus className="h-4 w-4" /> Tambah baris
              </Button>
              {(outputs.length > 0 || drafts.length > 0) && (
                <ConfirmButton title="Simpan rencana output" summary={`Daftar output ${job.job_no} diganti seluruhnya dengan ${drafts.length} baris.`} onConfirm={save}>
                  Simpan rencana output
                </ConfirmButton>
              )}
            </div>
          </div>
        )}

        {!editable && (
          <Table className="text-sm">
            <thead><tr><Th>#</Th><Th>Bin tujuan</Th><Th className="text-right">Qty</Th><Th>Sat</Th><Th>Paket</Th></tr></thead>
            <tbody>
              {outputs.map((o) => (
                <tr key={o.id}>
                  <Td>{o.line_no}</Td>
                  <Td>{o.bins?.bin_code ?? "—"}</Td>
                  <Td className="text-right tabular">{fmtNum(o.quantity)}</Td>
                  <Td>{o.unit}</Td>
                  <Td>{o.pkg_count ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {!editable && preview && (
          <p className="text-xs text-steel-500">
            Saat posting: {preview.pairs.filter((p) => p.crossBin).length} transfer antar-bin
            {preview.pairs.some((p) => p.sameBin) ? `, ${preview.pairs.filter((p) => p.sameBin).length} pasangan se-bin (tanpa perpindahan)` : ""}
            {preview.unallocatedSources.length > 0 ? `; ${preview.unallocatedSources.length} sumber tak teralokasi.` : "."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function postingSummary(job: WorkspaceJob, sources: SourceRow[], outputs: OutputRow[]): string {
  const preview = allocatePreview(
    sources.map((s) => ({ lineNo: s.line_no, quantity: Number(s.quantity), binCode: s.bins?.bin_code ?? "-" })),
    outputs.map((o) => ({ lineNo: o.line_no, quantity: Number(o.quantity), binCode: o.bins?.bin_code ?? "-" }))
  );
  const transfers = preview.pairs.filter((p) => p.crossBin).reduce((n, p) => n + 1, 0);
  const variance = computeVariance(job.input_qty ?? 0, job.output_qty ?? 0);
  return `Membuat ${transfers} perpindahan stok antar-bin${variance !== 0 ? `, penyesuaian selisih ${fmtNum(variance)} ${job.unit ?? ""} (${job.variance_reason ?? "BELUM ADA ALASAN — posting akan ditolak"})` : ", tanpa selisih"}, lalu ${outputs.length} paket aktif dibuat.`;
}

// --- Execution --------------------------------------------------------------

const DEFAULT_CHECKLIST: Array<{ item: string; label: string; ok: boolean }> = [
  { item: "kondisi", label: "Kondisi kemasan asal diperiksa", ok: false },
  { item: "label", label: "Label identitas mengikuti paket keluar", ok: false },
];

function ExecutionCard({ job, sources, outputs, byName }: { job: WorkspaceJob; sources: SourceRow[]; outputs: OutputRow[]; byName: string }) {
  const router = useRouter();
  const executor = job.status === "REJECTED";
  const checklistInit = (job.checklist && job.checklist.length > 0 ? job.checklist : DEFAULT_CHECKLIST).map((c) => ({ ...c }));
  const [outs, setOuts] = useState<Array<{ line_no: number; quantity: string; pkg_count: string }>>(
    (job.actual_outputs?.length ? job.actual_outputs : outputs.map((o) => ({ line_no: o.line_no, quantity: String(o.quantity), pkg_count: "" })))
      .map((o) => ({ line_no: o.line_no, quantity: String(o.quantity), pkg_count: String((o as { pkg_count?: number }).pkg_count ?? "") }))
  );
  const [checks, setChecks] = useState(checklistInit);
  const [error, setError] = useState<string | null>(null);

  const inputs = job.actual_inputs?.length ? job.actual_inputs : sources.map((s) => ({ line_no: s.line_no, quantity: Number(s.quantity) }));
  const inTotal = inputs.reduce((n, l) => n + Number(l.quantity), 0);
  const outTotal = outs.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  const variance = computeVariance(inTotal, outTotal);

  async function save(): Promise<string | null> {
    if (byName.trim().length < 2) return "Nama petugas minimal 2 karakter.";
    const { error } = await createClient().rpc("record_rebagging_execution", {
      p_job_id: job.id,
      p_inputs: inputs.map((l) => ({ line_no: l.line_no, quantity: Number(l.quantity), unit: job.unit ?? "" })),
      p_outputs: outs.map((l) => ({ line_no: l.line_no, quantity: Number(l.quantity), unit: job.unit ?? "", pkg_count: l.pkg_count ? Number(l.pkg_count) : undefined })),
      p_checklist: checks,
      p_by_name: byName.trim(),
    });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Eksekusi {executor ? "(perbaikan setelah ditolak)" : ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}

        {!samePerson(byName, job.executor_name) && (
          <p className="text-sm text-warn">
            Yang merekam harus eksekutor ({job.executor_name ?? "—"}). Isi Nama Anda sesuai.
          </p>
        )}

        <div>
          <Label>Input nyata (sama dengan rencana sumber)</Label>
          <Table className="mt-1 text-sm">
            <thead><tr><Th>#</Th><Th className="text-right">Qty</Th><Th>Sat</Th></tr></thead>
            <tbody>
              {inputs.map((l) => (
                <tr key={l.line_no}>
                  <Td>{l.line_no}</Td><Td className="text-right tabular">{fmtNum(l.quantity)}</Td><Td>{job.unit ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div>
          <Label>Output nyata per bin tujuan</Label>
          <div className="mt-1 space-y-2">
            {outputs.map((o, i) => (
              <div key={o.id || i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center">
                <span className="text-sm">{o.bins?.bin_code ?? `Baris ${o.line_no}`}</span>
                <Input inputMode="decimal" value={outs[i]?.quantity ?? ""} aria-label="Kuantitas output nyata"
                  onChange={(e) => setOuts((ds) => ds.map((row, j) => (j === i ? { ...row, quantity: e.target.value } : row)))} />
                <Input inputMode="numeric" value={outs[i]?.pkg_count ?? ""} aria-label="Jumlah paket"
                  onChange={(e) => setOuts((ds) => ds.map((row, j) => (j === i ? { ...row, pkg_count: e.target.value } : row)))} placeholder="paket" />
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label>Checklist kondisi</Label>
          <div className="mt-1 space-y-1.5">
            {checks.map((c, i) => (
              <label key={c.item} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.ok} aria-label={c.label}
                  onChange={(e) => setChecks((cs) => cs.map((row, j) => (j === i ? { ...row, ok: e.target.checked } : row)))} />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <p className={cn("text-sm", variance !== 0 ? "text-bad" : "text-ok")}>
          Rekonsiliasi: input {fmtNum(inTotal)} → output {fmtNum(outTotal)} — selisih {fmtNum(variance)} {job.unit ?? ""}.
          {variance !== 0 && " Nol selisih tidak wajib, tetapi supervisor harus menetapkan alasannya sebelum posting."}
        </p>

        <ConfirmButton
          title="Simpan eksekusi"
          summary={`Eksekusi ${job.job_no} disimpan: input ${fmtNum(inTotal)}, output ${fmtNum(outTotal)} ${job.unit ?? ""}.`}
          confirmLabel="Simpan"
          onConfirm={save}
        >
          Simpan eksekusi
        </ConfirmButton>
      </CardContent>
    </Card>
  );
}

// --- Verification -----------------------------------------------------------

function VerificationCard({ job, personName, onName }: { job: WorkspaceJob; personName: string; onName: (v: string) => void }) {
  const router = useRouter();
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const involved = samePerson(personName, job.executor_name) || samePerson(personName, job.creator_name);

  async function verify(approved: boolean): Promise<string | null> {
    if (personName.trim().length < 2) return "Nama verifikator minimal 2 karakter.";
    if (!approved && rejectNote.trim() === "") return "Alasan penolakan wajib diisi.";
    const { error } = await createClient().rpc("verify_rebagging", {
      p_job_id: job.id, p_approved: approved, p_note: approved ? `Verifikasi ${job.job_no}` : rejectNote.trim(),
      p_by_name: personName.trim(),
    });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  if (involved) {
    return (
      <Card>
        <CardHeader><CardTitle>Verifikasi</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-warn">
            Anda membuat atau mengeksekusi pekerjaan ini ({[job.creator_name, job.executor_name].filter(Boolean).join(" / ")}).
            Verifikasi harus dilakukan orang lain.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Verifikasi</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <PersonNameField value={personName} onChange={onName} label="Nama verifikator" id="verifier-name" />
        {samePerson(personName, job.executor_name) || samePerson(personName, job.creator_name) ? (
          <p className="text-sm text-bad">Verifikator tidak boleh eksekutor ({job.executor_name}) atau pembuat ({job.creator_name}).</p>
        ) : null}
        <Label htmlFor="reject-note">Catatan (wajib saat menolak)</Label>
        <Input id="reject-note" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Alasan bila menolak…" />
        <div className="flex flex-wrap gap-2">
          <ConfirmButton title="Setujui verifikasi" summary={`Pekerjaan ${job.job_no} menjadi Terverifikasi oleh ${personName.trim() || "—"}.`} confirmLabel="Setujui" onConfirm={() => verify(true)}>
            Setujui
          </ConfirmButton>
          <ConfirmButton title="Tolak verifikasi" summary={`Pekerjaan ${job.job_no} dikembalikan ke eksekutor untuk perbaikan. Catatan: "${rejectNote.trim()}"`} confirmLabel="Tolak" onConfirm={() => verify(false)}>
            Tolak
          </ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Variance resolve -------------------------------------------------------

function VarianceResolveCard({ job }: { job: WorkspaceJob }) {
  const router = useRouter();
  const [reason, setReason] = useState("COUNT_VARIANCE");
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle>Selesaikan varians</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="variance-reason">Kode alasan</Label>
            <Select id="variance-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {VARIANCE_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="variance-note">Keterangan (wajib)</Label>
            <Input id="variance-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Penjelasan selisih…" />
          </div>
        </div>
        <ConfirmButton
          title="Selesaikan varians"
          summary={`Varians ${fmtNum(Number(job.variance_qty))} ${job.unit ?? ""} diberi alasan ${reason} — "${note.trim()}".`}
          confirmLabel="Simpan"
          onConfirm={async () => {
            if (note.trim() === "") return "Keterangan varians wajib diisi.";
            const { error } = await createClient().rpc("resolve_rebagging_variance", {
              p_job_id: job.id, p_reason_code: reason, p_note: note.trim(),
            });
            if (error) return error.message;
            router.refresh();
            return null;
          }}
        >
          Simpan keputusan varians
        </ConfirmButton>
      </CardContent>
    </Card>
  );
}

// --- Evidence ---------------------------------------------------------------

function EvidenceCard({ job, evidence, canAdd, byName }: { job: WorkspaceJob; evidence: EvidenceRow[]; canAdd: boolean; byName: string }) {
  const kinds: EvidenceKind[] = ["BEFORE", "AFTER", "OTHER"];
  return (
    <Card>
      <CardHeader><CardTitle>Bukti foto</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {canAdd && (
          <div className="grid gap-3 sm:grid-cols-3">
            {kinds.map((k) => (
              <EvidenceUpload key={`${job.id}-${k}`} jobId={job.id} kind={k} byName={byName} />
            ))}
          </div>
        )}
        {kinds.map((k) => {
          const rows = evidence.filter((e) => e.kind === k);
          if (rows.length === 0) return null;
          return (
            <div key={k} className="space-y-2">
              <Label className="text-steel-700">{EVIDENCE_KIND_LABELS[k]}</Label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {rows.map((e) => (
                  <figure key={e.id} className="space-y-1">
                    <EvidenceImage storagePath={e.storage_path} alt={`Rebag ${job.job_no} — ${EVIDENCE_KIND_LABELS[k]}`} />
                    <figcaption className="text-xs text-steel-500">
                      {fmtDateTime(e.uploaded_at)} · {e.uploader_name}{e.note ? ` · ${e.note}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          );
        })}
        {evidence.length === 0 && (
          <p className="text-sm text-steel-500">Belum ada foto. Foto sebelum dan sesudah wajib sebelum verifikasi.</p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Timeline ---------------------------------------------------------------

function TimelineCard({ events, job }: { events: EventRow[]; job: WorkspaceJob }) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><Clock className="h-4 w-4 text-steel-500" /><CardTitle>Riwayat</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="tabular text-steel-500">{fmtDateTime(e.at)}</span>
              <Badge className="bg-steel-100">{EVENT_LABELS[e.event_type] ?? e.event_type}</Badge>
              {e.by_name && <span>{e.by_name}</span>}
              {e.note && <span className="text-steel-500">{e.note}</span>}
            </li>
          ))}
          {events.length === 0 && <li className="text-sm text-steel-500">Belum ada riwayat untuk {job.job_no}.</li>}
        </ol>
      </CardContent>
    </Card>
  );
}

export function CameraHint() {
  return (
    <p className="text-xs text-steel-500"><Camera className="h-3 w-3 inline" /> Foto dikirim ke bucket privat; tautan berumur pendek.</p>
  );
}
