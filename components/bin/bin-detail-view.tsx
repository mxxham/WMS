"use client";
import { BinPlate } from "@/components/bin/bin-plate";
import { MovementActions } from "@/components/bin/movement-actions";
import { ExpiryBadge } from "@/components/ui/badge";
import { Table, Th, Td } from "@/components/ui/table";
import { daysUntil, expiryStatus, type ExpiryStatus } from "@/config/warehouse";
import type { BinDetail } from "@/lib/bin-data";
import type { Role } from "@/lib/types";
import Link from "next/link";
import { HOLD_REASONS, REASON_CODES, type HoldReason, type ReasonCode } from "@/lib/inventory-control";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { changeText, dayKey, emptiedToday, type DayRow } from "@/lib/bin-day-stock";

const rowTone: Record<ExpiryStatus, string> = {
  // A wash only: the ExpiryBadge in each row carries the state in words (DESIGN.md §5).
  expired: "bg-bad/5",
  near: "bg-warn/10",
  ok: "",
  unknown: "",
};
/**
 * Today's Laporan WMS harian rows of one bin (wms_day_report, 0055), so Isi bin can show this morning's on hand next
 * to the current quantity. Re-read whenever the bin's stock changes. null while loading or when it cannot be read:
 * the table then shows the current quantity only.
 */
function useBinDay(code: string, version: unknown): DayRow[] | null {
  const [rows, setRows] = useState<DayRow[] | null>(null);
  useEffect(() => {
    let live = true;
    createClient().rpc("wms_day_report", { p_date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }) })
      .select("bin_code, sku, description, uom, batch_lot, expiry_date, on_hand, pick, b_out, b_in, remain").eq("bin_code", code)
      .then(({ data, error }) => { if (live) setRows(error ? null : ((data ?? []) as DayRow[])); });
    return () => { live = false; };
  }, [code, version]);
  return rows;
}

const moveLabel: Record<string, string> = { inbound: "Terima", putaway: "Putaway", picking: "Pick", transfer: "Transfer", adjustment: "Adjust" };

export function BinDetailView({ detail, role, onChanged, compact = false }: { detail: BinDetail; role: Role; onChanged: () => void; compact?: boolean }) {
  const { bin, inventory, movements, fillRatio } = detail;
  const pct = fillRatio === null ? null : Math.round(fillRatio * 100);
  const day = useBinDay(bin.bin_code, inventory);
  const dayOf = new Map((day ?? []).map((r) => [dayKey(r), r]));
  const keyOf = (r: (typeof inventory)[number]) => dayKey({ sku: r.items?.sku ?? "", batch_lot: r.batch_lot, expiry_date: r.expiry_date });
  const gone = day ? emptiedToday(day, new Set(inventory.map(keyOf))) : [];
  /** This morning's on hand of a current line; without a report row (not loaded) the column shows a dash. */
  const morning = (r: (typeof inventory)[number]) => { const d = dayOf.get(keyOf(r)); return d ? fmtNum(Number(d.on_hand)) : "–"; };

  return (
    <div className="space-y-5">
      <BinPlate bin={bin} compact={compact} />

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Utilisasi">
          {pct === null ? "–" : `${pct}%`}
          {pct !== null && (
            <div className="mt-1 h-1.5 w-full rounded bg-steel-100">
              <div className={cn("h-1.5 rounded", pct > 100 ? "bg-bad" : "bg-ckb")} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          )}
        </Stat>
        <Stat label="Kelas ABC">{bin.abc_class ?? inventory[0]?.items?.abc_class ?? "–"}</Stat>
        <Stat label="Baris stok">{inventory.length}</Stat>
      </div>

      <MovementActions bin={bin} inventory={inventory} role={role} onDone={onChanged} />

      <section>
        <h2 className="font-cond text-lg font-semibold">Isi bin <span className="text-sm font-normal text-steel-500">urut FEFO</span></h2>
        <p className="mb-2 text-xs text-steel-500">On hand pagi = stok pagi ini setelah putaway, sebelum picking. Sekarang = sisa saat ini (Remain).
          Sama dengan Laporan WMS harian.</p>
        {inventory.length === 0 && gone.length === 0 ? (
          <p className="rounded-md border border-dashed border-steel-300 p-4 text-sm text-steel-500">Bin kosong. Gunakan Putaway untuk mengisi.</p>
        ) : (
          <>
            {/* Cards on phones: a 9-column table does not fit one hand */}
            <ul className="space-y-2 sm:hidden">
              {inventory.map((r) => {
                const st = expiryStatus(r.expiry_date); const d = daysUntil(r.expiry_date);
                return (
                  <li key={r.id} className={cn("rounded-md bg-white p-3", rowTone[st])}>
                    <div className="flex items-start justify-between gap-2">
                      <div><div className="font-semibold tabular">{r.items?.sku}</div><div className="text-xs text-steel-500">{r.items?.description}</div></div>
                      <ExpiryBadge status={st} />
                    </div>
                    <div className="mt-1 text-sm tabular">
                      On hand pagi <span className="font-semibold">{morning(r)}</span> · sekarang <span className="text-base font-semibold">{fmtNum(r.quantity)}</span> {r.items?.uom}
                      {changeText(dayOf.get(keyOf(r))) && <span className="block text-xs text-steel-500">Hari ini: {changeText(dayOf.get(keyOf(r)))}</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs tabular">
                      <div><div className="text-steel-500">Batch</div>{r.batch_lot || "–"}</div>
                      <div><div className="text-steel-500">Expired</div>{fmtDate(r.expiry_date)}{d !== null && <div>{d} hari</div>}</div>
                    </div>
                    {!!r.held && <HeldNote held={r.held} reasons={r.hold_reasons} />}
                  </li>
                );
              })}
              {gone.map((g) => (
                <li key={dayKey(g)} className="rounded-md border border-dashed border-steel-300 p-3 text-sm">
                  <span className="font-semibold tabular">{g.sku}</span> · {g.batch_lot || "tanpa batch"}
                  <div className="tabular">On hand pagi <span className="font-semibold">{fmtNum(Number(g.on_hand))}</span> · sekarang <span className="font-semibold">0</span></div>
                  <div className="text-xs text-steel-500">Hari ini: {changeText(g)}</div>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table>
                <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th>Batch/Lot</Th><Th>Expired</Th><Th className="text-right">Sisa hari</Th>
                  <Th className="text-right">On hand pagi</Th><Th>Hari ini</Th><Th className="text-right">Sekarang</Th><Th>UoM</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {inventory.map((r) => {
                    const st = expiryStatus(r.expiry_date);
                    return (
                      <tr key={r.id} className={rowTone[st]}>
                        <Td>{r.items?.sku}</Td><Td>{r.items?.description}</Td><Td>{r.batch_lot || "–"}</Td>
                        <Td>{fmtDate(r.expiry_date)}</Td><Td className="text-right">{daysUntil(r.expiry_date) ?? "–"}</Td>
                        <Td className="text-right tabular">{morning(r)}</Td>
                        <Td className="text-xs text-steel-500">{changeText(dayOf.get(keyOf(r))) || "–"}</Td>
                        <Td className="text-right font-semibold">{fmtNum(r.quantity)}{!!r.held && <HeldNote held={r.held} reasons={r.hold_reasons} />}</Td><Td>{r.items?.uom ?? "–"}</Td>
                        <Td><ExpiryBadge status={st} /></Td>
                      </tr>
                    );
                  })}
                  {gone.map((g) => (
                    <tr key={dayKey(g)} className="text-steel-500">
                      <Td>{g.sku}</Td><Td>{g.description}</Td><Td>{g.batch_lot || "–"}</Td><Td>{fmtDate(g.expiry_date)}</Td><Td />
                      <Td className="text-right tabular">{fmtNum(Number(g.on_hand))}</Td><Td className="text-xs">{changeText(g) || "–"}</Td>
                      <Td className="text-right font-semibold">0</Td><Td>{g.uom ?? "–"}</Td><Td>habis hari ini</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-cond text-lg font-semibold">10 mutasi terakhir</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-steel-500">Belum ada mutasi.</p>
        ) : (
          <ol className="divide-y divide-steel-100 rounded-md bg-white text-sm">
            {movements.map((m) => {
              const out = m.from_bin?.bin_code === bin.bin_code && m.type !== "adjustment";
              const pt = (m as any).pick_tasks ?? (m as any).pick_task ?? null;
              const w = pt?.waves ? (Array.isArray(pt.waves) ? pt.waves[0] : pt.waves) : null;
              const href = pt?.wave_id && w?.planned_date ? `/waves?date=${w.planned_date}&wave=${pt.wave_id}` : null;
              const row = (
                <div className="flex items-start justify-between gap-3 px-3 py-2">
                  <div>
                    <span className="font-semibold">{moveLabel[m.type]}</span>{" "}
                    <span className="tabular">{m.items?.sku}</span>{m.batch_lot ? <span className="text-steel-500"> · {m.batch_lot}</span> : null}
                    <div className="text-xs text-steel-500">
                      {m.from_bin?.bin_code ?? "—"} → {m.to_bin?.bin_code ?? "—"} · {m.by_name ?? m.profiles?.name ?? "Sistem"}{m.approved_by_name && m.approved_by_name !== m.by_name ? ` (disetujui ${m.approved_by_name})` : ""} · {fmtDateTime(m.created_at)}
                      {m.reason_code ? ` · ${REASON_CODES[m.reason_code as ReasonCode] ?? m.reason_code}` : ""}{m.note ? ` · ${m.note}` : ""}
                      {pt?.shipment_number ? <span className="text-ckb"> · shipment {pt.shipment_number}</span> : null}
                      {href && <span className="text-ckb"> · lihat wave →</span>}
                    </div>
                  </div>
                  <div className={cn("font-semibold tabular", out || m.quantity < 0 ? "text-bad" : "text-ok")}>
                    {out ? "−" : m.quantity < 0 ? "" : "+"}{fmtNum(m.quantity)}
                  </div>
                </div>
              );
              return (
                <li key={m.id} className="hover:bg-steel-50">
                  {href ? <Link href={href} className="block">{row}</Link> : row}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function HeldNote({ held, reasons }: { held: number; reasons?: string | null }) {
  return (
    <Link href="/inventory?tab=hold" className="mt-1 block text-xs font-semibold text-warn underline">
      {fmtNum(held)} ditahan{reasons ? ` (${reasons.split(", ").map((r) => HOLD_REASONS[r as HoldReason] ?? r).join(", ")})` : ""}
    </Link>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-white p-3">
      <div className="text-xs text-steel-500">{label}</div>
      <div className="font-cond text-2xl font-semibold tabular">{children}</div>
    </div>
  );
}
