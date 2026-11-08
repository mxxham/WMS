import type { Metadata } from "next";
import Link from "next/link";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { CkbHeader, CkbBody, EmptyState, Notice, StatTile } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventaris" };

type Row = { material_code: string; description: string; plant: string; storage_location: string; storage_bin: string; batch: string; expiry_date: string | null; uom: string; quantity: number; identity_key: string };
type Adj = { material_code: string; storage_bin: string; batch: string; expiry_date: string | null; uom: string; delta: number; status: string };

/**
 * CKB stock as the active SAP snapshot states it. There is no CKB stock ledger yet (docs/CKB_3PL.md
 * §9): approved stock-take adjustments are shown beside the snapshot, never folded into it.
 */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCkb("/ckb/inventory");
  // 0133: a counter (operator) never sees SAP quantities: locations and materials only.
  const counter = user.ckbRole === "operator";
  const sp = await searchParams;
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, name, active_snapshot_id").order("name");
  const customer = (customers ?? []).find((c) => c.id === sp.customer) ?? (customers ?? []).find((c) => c.active_snapshot_id);
  const term = (sp.material ?? "").trim().toUpperCase();

  let rows: Row[] = [], adjustments: Adj[] = [];
  let snap: { ref_no: string; snapshot_date: string; mapping_verified: boolean } | null = null;
  let locations: { storage_bin: string; material_code: string; description: string; uom: string }[] = [];
  if (customer?.active_snapshot_id && counter) {
    const { data } = await db.rpc("ckb_inventory_locations", { p_customer: customer.id });
    locations = (data ?? []) as typeof locations;
  } else if (customer?.active_snapshot_id) {
    const sid = customer.active_snapshot_id;
    [rows, adjustments] = await Promise.all([
      fetchAll<Row>((a, b) => db.from("ckb_sap_snapshot_rows").select("material_code, description, plant, storage_location, storage_bin, batch, expiry_date, uom, quantity, identity_key")
        .eq("import_id", sid).order("storage_bin").order("material_code").order("id").range(a, b)),
      fetchAll<Adj>((a, b) => db.from("ckb_adjustments").select("material_code, storage_bin, batch, expiry_date, uom, delta, status")
        .eq("customer_id", customer.id).in("status", ["PROPOSED", "APPROVED", "EXPORTED"]).order("ref_no").range(a, b)),
    ]);
    const { data } = await db.from("ckb_sap_imports").select("ref_no, snapshot_date, mapping_verified").eq("id", sid).single();
    snap = data;
  }
  const k = (r: { material_code: string; storage_bin: string; batch: string; expiry_date: string | null; uom: string }) =>
    [r.material_code, r.storage_bin, r.batch, r.expiry_date ?? "", r.uom].map((x) => String(x).toUpperCase()).join("|");
  const pending = new Map<string, { proposed: number; approved: number }>();
  for (const a of adjustments) {
    const p = pending.get(k(a)) ?? { proposed: 0, approved: 0 };
    if (a.status === "PROPOSED") p.proposed += Number(a.delta); else p.approved += Number(a.delta);
    pending.set(k(a), p);
  }
  const shown = term ? rows.filter((r) => r.material_code.toUpperCase().includes(term) || r.storage_bin.includes(term) || r.description.toUpperCase().includes(term)) : rows;
  const total = shown.reduce((s, r) => s + Number(r.quantity), 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main>
      <CkbHeader title="Inventaris" subtitle={customer ? `${customer.name}${snap ? ` · snapshot ${snap.ref_no}, stok SAP per ${fmtDate(snap.snapshot_date)}` : ""}` : undefined} />
      <CkbBody>
        <FilterBar fields={[
          { name: "customer", label: "Customer", kind: "select", all: "Pilih customer", options: (customers ?? []).map((c) => ({ value: c.id, label: `${c.name}${c.active_snapshot_id ? "" : " (tanpa snapshot)"}` })) },
          { name: "material", label: "Material / bin / deskripsi", kind: "text" },
        ]} />
        {counter && customer?.active_snapshot_id && (
          <>
            <Notice title="Lokasi barang, tanpa jumlah">Penghitung tidak melihat jumlah SAP. Daftar ini menunjukkan di mana tiap material tercatat.</Notice>
            {(() => {
              const list = term ? locations.filter((r) => r.material_code.toUpperCase().includes(term) || r.storage_bin.toUpperCase().includes(term) || r.description.toUpperCase().includes(term)) : locations;
              return list.length === 0 ? <EmptyState title="Tidak ada baris untuk filter ini" /> : (
                <div className="rounded-lg border border-steel-100 bg-white">
                  <Table sticky>
                    <thead><tr><Th>Lokasi</Th><Th>Material</Th><Th>Satuan</Th></tr></thead>
                    <tbody>{list.slice(0, 3000).map((r, i) => (
                      <tr key={`${r.storage_bin}-${r.material_code}-${i}`}>
                        <Td className="font-cond font-semibold">{r.storage_bin || "–"}</Td>
                        <Td><span className="font-medium">{r.material_code}</span><span className="block max-w-[18rem] truncate text-xs text-steel-500">{r.description}</span></Td>
                        <Td>{r.uom}</Td>
                      </tr>
                    ))}</tbody>
                  </Table>
                </div>
              );
            })()}
          </>
        )}
        {!counter && <Notice title="Saldo menurut snapshot SAP, bukan saldo hidup">
          CKB belum punya buku stok sendiri. Angka di sini adalah snapshot SAP yang aktif. Penyesuaian hasil stock take
          ditampilkan terpisah dan baru berlaku setelah diposting di SAP; aplikasi tidak mengubah angka snapshot.
        </Notice>}
        {snap && !snap.mapping_verified && <Notice tone="warn">Snapshot ini dibaca dengan pemetaan kolom yang belum diverifikasi.</Notice>}
        {counter && customer?.active_snapshot_id ? null : !customer ? <EmptyState title="Belum ada customer dengan snapshot aktif" action={<Link className="text-ckb underline" href="/ckb/sap/import">Import SAP</Link>} /> :
          !customer.active_snapshot_id ? <EmptyState title={`${customer.name} belum punya snapshot aktif`} action={<Link className="text-ckb underline" href="/ckb/sap/import">Import SAP</Link>} /> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Baris stok" value={fmtNum(shown.length)} />
              <StatTile label="Total qty (semua satuan)" value={fmtNum(total, 3)} />
              <StatTile label="Penyesuaian menunggu persetujuan" value={adjustments.filter((a) => a.status === "PROPOSED").length} tone="warn" />
              <StatTile label="Penyesuaian disetujui, belum di SAP" value={adjustments.filter((a) => a.status !== "PROPOSED").length} />
            </div>
            {shown.length === 0 ? <EmptyState title="Tidak ada baris untuk filter ini" /> : (
              <div className="rounded-lg border border-steel-100 bg-white">
                <Table sticky>
                  <thead><tr><Th>Bin</Th><Th>Material</Th><Th>Batch</Th><Th>Expired</Th><Th>Satuan</Th><Th className="text-right">Qty SAP</Th><Th className="text-right">Usulan</Th><Th className="text-right">Disetujui (belum di SAP)</Th></tr></thead>
                  <tbody>
                    {shown.slice(0, 3000).map((r, i) => {
                      const p = pending.get(k(r));
                      const expired = r.expiry_date && r.expiry_date < today;
                      return (
                        <tr key={`${r.identity_key}-${i}`}>
                          <Td className="font-cond font-semibold">{r.storage_bin || "–"}</Td>
                          <Td><span className="font-medium">{r.material_code}</span><span className="block max-w-[18rem] truncate text-xs text-steel-500">{r.description}</span></Td>
                          <Td>{r.batch || "–"}</Td>
                          <Td className={expired ? "font-medium text-bad" : ""}>{r.expiry_date ? fmtDate(r.expiry_date) : "–"}</Td>
                          <Td>{r.uom}</Td>
                          <Td className="text-right">{fmtNum(Number(r.quantity), 3)}</Td>
                          <Td className="text-right text-warn">{p?.proposed ? `${p.proposed > 0 ? "+" : ""}${fmtNum(p.proposed, 3)}` : ""}</Td>
                          <Td className="text-right">{p?.approved ? `${p.approved > 0 ? "+" : ""}${fmtNum(p.approved, 3)}` : ""}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {shown.length > 3000 && <p className="p-3 text-sm text-steel-500">Menampilkan 3.000 dari {fmtNum(shown.length)} baris. Persempit dengan pencarian, atau buka snapshot untuk semua baris.</p>}
              </div>
            )}
          </>
        )}
      </CkbBody>
    </main>
  );
}
