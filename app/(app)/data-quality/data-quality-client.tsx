"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ISSUES, type Issue, type IssueKind } from "@/lib/data-quality";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/utils";
import { PersonNameField, usePersonName } from "@/components/app/person-name";

export function DataQualityClient({ issues, countBins }: { issues: Issue[]; countBins: string[] }) {
  const kinds = Object.keys(ISSUES) as IssueKind[];
  const counting = new Set(countBins);
  const [person, setPerson] = usePersonName();
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama petugas (dicatat di setiap koreksi)" />
      <p className="max-w-3xl text-sm text-steel-500">
        Diperiksa langsung dari stok di sistem. Koreksi batch/expired memposting dua penyesuaian (identitas lama → baru) ke riwayat mutasi; qty tidak berubah.
        Baris WMS dengan Remain Qty 0 tidak pernah diimpor sebagai stok, jadi tidak ada yang perlu dibersihkan di sini untuk baris itu. Rapikan di file WMS.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {kinds.map((k) => (
          <a key={k} href={`#${k}`} className="rounded-lg border-l-4 border-warn bg-white p-3">
            <div className="font-cond text-3xl font-semibold tabular">{fmtNum(issues.filter((i) => i.kind === k).length)}</div>
            <div className="text-xs text-steel-500">{ISSUES[k].title}</div>
          </a>
        ))}
      </div>
      {kinds.map((k) => {
        const list = issues.filter((i) => i.kind === k);
        if (list.length === 0) return null;
        return (
          <Card key={k} id={k}>
            <CardHeader><CardTitle>{ISSUES[k].title} · {fmtNum(list.length)}</CardTitle><p className="text-xs text-steel-500">{ISSUES[k].why}</p></CardHeader>
            <CardContent>
              <Table>
                <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th>Catatan</Th><Th>Perbaikan</Th></tr></thead>
                <tbody>{list.map((i) => (
                  <tr key={`${i.row.bin_code}|${i.row.sku}|${i.row.batch_lot}|${i.row.expiry_date}|${k}`}>
                    <Td className="font-semibold"><Link className="underline" href={`/bin/${i.row.bin_code}`}>{i.row.bin_code}</Link></Td>
                    <Td>{i.row.sku}<div className="text-xs text-steel-500">{i.row.description}</div></Td>
                    <Td>{i.row.batch_lot || "–"}</Td><Td>{fmtDate(i.row.expiry_date)}</Td>
                    <Td className="text-right tabular">{fmtNum(i.row.quantity)}</Td><Td className="text-xs">{i.detail}</Td>
                    <Td><Fix issue={i} counting={counting.has(i.row.bin_code)} person={person} /></Td>
                  </tr>
                ))}</tbody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      {issues.length === 0 && <p className="text-sm">Tidak ada masalah data yang terdeteksi.</p>}
    </div>
  );
}

function Fix({ issue, counting, person }: { issue: Issue; counting: boolean; person: string }) {
  const router = useRouter();
  const fix = ISSUES[issue.kind].fix;
  const [value, setValue] = useState(issue.suggestedBatch ?? issue.suggestedExpiry ?? "");
  const [reason, setReason] = useState(issue.suggestedBatch ? "Batch terbaca sebagai tanggal oleh Excel"
    : issue.kind === "expiry_vs_batch" ? `Expired disamakan dengan kode batch ${issue.row.batch_lot} (cek label)` : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setError(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  if (fix === "count") {
    if (counting) return <Link className="text-xs underline" href="/counts">Sudah di daftar hitung</Link>;
    return (
      <div>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => run("create_count_task", { p_bin_code: issue.row.bin_code, p_reason: `${ISSUES[issue.kind].title}: ${issue.detail}`, p_source: "DATA_QUALITY" })}>Buat tugas hitung</Button>
        {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      </div>
    );
  }

  const r = issue.row;
  return (
    <div className="flex min-w-72 flex-wrap items-center gap-1">
      <Input aria-label={fix === "batch" ? "Batch benar" : "Expired benar"} type={fix === "expiry" ? "date" : "text"} className="h-8 w-32"
        value={value} onChange={(e) => setValue(e.target.value)} placeholder={fix === "batch" ? "Batch di label" : ""} />
      <Input aria-label="Alasan" className="h-8 w-40" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan (wajib)" />
      <Button size="sm" disabled={busy || !value.trim() || !reason.trim() || person.trim().length < 2}
        title={person.trim().length < 2 ? "Isi nama petugas di atas" : undefined} onClick={() => run("correct_stock_identity", {
        p_bin_code: r.bin_code, p_sku: r.sku, p_batch: r.batch_lot, p_expiry: r.expiry_date,
        p_new_batch: fix === "batch" ? value.trim() : null, p_new_expiry: fix === "expiry" ? value : null, p_reason: reason, p_by_name: person,
      })}>Koreksi</Button>
      {error && <p role="alert" className="w-full text-xs text-bad">{error}</p>}
    </div>
  );
}
