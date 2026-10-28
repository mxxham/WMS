"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { RECON_STATUS } from "@/lib/inventory-control";
import {
  CAUSES, FILTERS, FLAG_LABEL, SORTS, causeBreakdown, direction, filterLines, flags, gapBlocked, gapTotal, gapUnrestricted, hasGap, hint,
  mvtLabel, sapTotal, signed, timingTotal, wmsTotal, type CauseCode, type FilterKey, type SortKey,
} from "@/lib/sap-compare";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import type { PrevGap, ReconLine, ReconSummary, SapMove } from "./types";

const num = (v: unknown) => Number(v ?? 0) || 0;

/** md and up: the table; below: cards. Only one is mounted, so an opened SKU loads once. */
function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

/** "Lebih 5" / "Kurang 3" / "Cocok", from our side; SAP is the reference. */
export function GapBadge({ gap, className }: { gap: number; className?: string }) {
  if (!gap) return <span className={cn("inline-block rounded bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok", className)}>Cocok</span>;
  return gap > 0
    ? <span className={cn("inline-block rounded bg-ckb/15 px-2 py-0.5 text-xs font-semibold text-ckb-dark", className)}>Lebih {fmtNum(gap)}</span>
    : <span className={cn("inline-block rounded bg-bad/15 px-2 py-0.5 text-xs font-semibold text-bad", className)}>Kurang {fmtNum(-gap)}</span>;
}

/** Bar from the centre: left (red) = we hold less than SAP, right (blue) = more. */
function GapBar({ gap, max }: { gap: number; max: number }) {
  const w = max ? Math.min(50, (50 * Math.abs(gap)) / max) : 0;
  return (
    <div className="relative h-2 w-full rounded bg-steel-100" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-steel-300" />
      {gap !== 0 && <div className={cn("absolute inset-y-0 rounded", gap > 0 ? "left-1/2 bg-ckb" : "right-1/2 bg-bad")} style={{ width: `${Math.max(w, 1)}%` }} />}
    </div>
  );
}

export function StockCompare({ run, lines, moves, prev, prevAsOf, person }: {
  run: ReconSummary; lines: ReconLine[]; moves: SapMove[]; prev: PrevGap | null; prevAsOf: string | null; person: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("diff");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("gap");
  const [uom, setUom] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const desktop = useDesktop();
  const editable = run.status === "OPEN";
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as FilterKey[]).map((k) => [k, lines.filter(FILTERS[k].test).length])) as Record<FilterKey, number>, [lines]);
  const shown = useMemo(() => filterLines(lines, filter, query, sort, uom), [lines, filter, query, sort, uom]) as ReconLine[];
  const uoms = useMemo(() => [...new Set(lines.map((l) => l.sap_uom || l.wms_uom).filter((u): u is string => !!u))].sort(), [lines]);
  const max = useMemo(() => Math.max(1, ...lines.map((l) => Math.abs(gapTotal(l)))), [lines]);
  const top = useMemo(() => lines.filter(hasGap).sort((a, b) => Math.abs(gapTotal(b)) - Math.abs(gapTotal(a))).slice(0, 10), [lines]);
  const causes = useMemo(() => causeBreakdown(lines), [lines]);
  const movesBySku = useMemo(() => {
    const m = new Map<string, SapMove[]>();
    for (const x of moves) m.set(x.sku, [...(m.get(x.sku) ?? []), x]);
    return m;
  }, [moves]);
  const recountable = lines.filter((l) => l.item_id && l.status === "OPEN" && hasGap(l)).length;
  const otherSlocs = run.other_slocs ?? [];

  async function recountAll(): Promise<string | null> {
    const { data, error } = await createClient().rpc("request_recon_counts_all", { p_recon_id: run.id, p_by_name: person });
    if (error) return error.message;
    const r = data as { lines: number; count_tasks: number };
    setBulkMsg(`${fmtNum(r.count_tasks)} tugas hitung dibuat untuk ${fmtNum(r.lines)} SKU.`);
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-4">
      {top.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">10 selisih terbesar (WMS − SAP)</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {top.map((l) => (
                <button key={l.sku} type="button" onClick={() => { setFilter("all"); setQuery(l.sku); setOpen(l.sku); }}
                  className="grid w-full grid-cols-[7rem_1fr_5.5rem] items-center gap-2 text-left text-xs hover:bg-paper sm:grid-cols-[14rem_1fr_6rem]">
                  <span className="truncate"><b>{l.sku}</b> <span className="hidden text-steel-500 sm:inline">{l.description}</span></span>
                  <GapBar gap={gapTotal(l)} max={Math.abs(gapTotal(top[0]))} />
                  <span className={cn("text-right font-semibold tabular", gapTotal(l) > 0 ? "text-ckb-dark" : "text-bad")}>{signed(gapTotal(l))}</span>
                </button>
              ))}
              <p className="pt-1 text-xs text-steel-500">Kiri merah = stok WMS kurang dari SAP. Kanan biru = WMS lebih dari SAP. Klik untuk membuka SKU.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Penyebab selisih</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>{causes.map((c) => (
                  <tr key={c.cause ?? "none"} className="border-b border-steel-100 last:border-0">
                    <td className={cn("py-1", !c.cause && "text-warn")}>{c.cause ? CAUSES[c.cause] : "Belum dijelaskan"}</td>
                    <td className="py-1 text-right tabular">{fmtNum(c.lines)} SKU</td>
                    <td className="py-1 text-right tabular">{fmtNum(c.qty)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={cn("rounded-md border px-3 py-1.5 text-sm", filter === k ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white hover:bg-steel-100")}>
            {FILTERS[k].label} <span className="tabular opacity-80">{fmtNum(counts[k])}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-steel-400" />
          <Input aria-label="Cari SKU" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari SKU / nama barang" />
        </div>
        <Select aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-48">
          {(Object.keys(SORTS) as SortKey[]).map((k) => <option key={k} value={k}>{SORTS[k].label}</option>)}
        </Select>
        {uoms.length > 1 && (
          <Select aria-label="Satuan" value={uom} onChange={(e) => setUom(e.target.value)} className="w-32">
            <option value="">Semua satuan</option>{uoms.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        )}
        {editable && recountable > 0 && (
          <ConfirmButton variant="outline" title="Hitung ulang semua selisih" confirmLabel="Buat tugas hitung"
            summary={`Buat tugas hitung untuk setiap bin dari ${fmtNum(recountable)} SKU yang selisih dan belum ditangani. Status SKU menjadi "Hitung ulang diminta".`}
            onConfirm={recountAll} disabled={person.trim().length < 2}>Hitung ulang semua ({fmtNum(recountable)})</ConfirmButton>
        )}
        {bulkMsg && <p className="text-sm text-ok">{bulkMsg} <Link className="underline" href="/counts">Buka Hitung</Link></p>}
      </div>
      <p className="text-xs text-steel-500">
        Selisih = stok WMS − stok SAP setelah koreksi timing (pending GI + GI otomatis − pending GR). <b>Lebih</b> = kita punya lebih dari SAP, <b>Kurang</b> = kita punya kurang dari SAP.
        {otherSlocs.length > 0 && <> Kolom &quot;Lokasi SAP lain&quot; = stok SAP di {otherSlocs.join(", ")}, tidak ikut dibandingkan.</>}
      </p>

      {shown.length === 0 ? <p className="rounded-md bg-white p-4 text-sm text-ok">Tidak ada SKU untuk filter ini.</p> : (
        <>
          {desktop ? <Card>
            <CardContent className="p-0">
              <Table>
                <thead><tr>
                  <Th className="w-6" /><Th>SKU</Th><Th className="text-right">SAP</Th><Th className="text-right">WMS</Th><Th className="text-right">Koreksi timing</Th>
                  <Th className="w-56">Selisih (WMS − SAP)</Th><Th className="text-right">Blok SAP / WMS</Th>
                  {otherSlocs.length > 0 && <Th className="text-right">Lokasi SAP lain</Th>}
                  {prev && <Th className="text-right" title={prevAsOf ? `Rekonsiliasi ${fmtDate(prevAsOf)}` : undefined}>Sebelumnya</Th>}
                  <Th>Status</Th>
                </tr></thead>
                <tbody>{shown.map((l) => {
                  const g = gapTotal(l), isOpen = open === l.sku, p = prev?.[l.sku];
                  const repeat = p !== undefined && p !== 0 && Math.sign(p) === Math.sign(g);
                  return (
                    <Fragment key={l.id}>
                      <tr className={cn("cursor-pointer hover:bg-paper", hasGap(l) && l.status === "OPEN" && "bg-warn/5", isOpen && "bg-paper")} onClick={() => setOpen(isOpen ? null : l.sku)}>
                        <Td>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Td>
                        <Td><span className="font-semibold">{l.sku}</span><div className="max-w-72 truncate text-xs">{l.description}</div><FlagChips l={l} /></Td>
                        <Td className="text-right tabular">{fmtNum(num(l.sap_unrestricted))}<div className="text-xs text-steel-500">{l.sap_uom}</div></Td>
                        <Td className="text-right tabular">{fmtNum(num(l.wms_unrestricted))}<div className="text-xs text-steel-500">{l.wms_uom}</div></Td>
                        <Td className="text-right text-xs tabular">{timingTotal(l) ? signed(timingTotal(l)) : "–"}</Td>
                        <Td>
                          <div className="flex items-center justify-between gap-2"><GapBadge gap={g} /><span className="text-xs tabular text-steel-500">{sapTotal(l) ? `${fmtNum(Math.abs(g) * 100 / sapTotal(l), 1)}%` : ""}</span></div>
                          <GapBar gap={g} max={max} />
                          {gapBlocked(l) !== 0 && <div className="text-xs">bebas {signed(gapUnrestricted(l))} · blok {signed(gapBlocked(l))}</div>}
                        </Td>
                        <Td className="text-right tabular">{num(l.sap_blocked) || num(l.wms_blocked) ? `${fmtNum(num(l.sap_blocked))} / ${fmtNum(num(l.wms_blocked))}` : "–"}</Td>
                        {otherSlocs.length > 0 && <Td className="text-right text-xs tabular">{Object.entries(l.sap_other ?? {}).map(([k, v]) => <div key={k}>{k} {fmtNum(num(v))}</div>)}</Td>}
                        {prev && <Td className="text-right text-xs tabular">{p === undefined ? "–" : signed(p)}{repeat && <div className="font-semibold text-bad">berulang</div>}</Td>}
                        <Td className="text-xs">{RECON_STATUS[l.status]}{l.cause && <div className="text-steel-500">{CAUSES[l.cause]}</div>}</Td>
                      </tr>
                      {isOpen && (
                        <tr><td colSpan={11} className="border-b border-steel-200 bg-paper p-3">
                          <SkuDetail l={l} moves={movesBySku.get(l.sku) ?? []} run={run} person={person} editable={editable} />
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}</tbody>
              </Table>
            </CardContent>
          </Card> : (

          <div className="space-y-2">
            {shown.map((l) => {
              const g = gapTotal(l), isOpen = open === l.sku;
              return (
                <div key={l.id} className={cn("rounded-lg border bg-white p-3", hasGap(l) && l.status === "OPEN" ? "border-warn" : "border-steel-200")}>
                  <button type="button" className="w-full text-left" onClick={() => setOpen(isOpen ? null : l.sku)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><div className="font-semibold">{l.sku}</div><div className="truncate text-xs">{l.description}</div></div>
                      <GapBadge gap={g} />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                      <div className="rounded bg-paper p-1">SAP<div className="text-base font-semibold tabular">{fmtNum(sapTotal(l))}</div></div>
                      <div className="rounded bg-paper p-1">WMS<div className="text-base font-semibold tabular">{fmtNum(wmsTotal(l))}</div></div>
                      <div className="rounded bg-paper p-1">Timing<div className="text-base font-semibold tabular">{timingTotal(l) ? signed(timingTotal(l)) : "–"}</div></div>
                    </div>
                    <div className="mt-2"><GapBar gap={g} max={max} /></div>
                    <FlagChips l={l} />
                    <div className="mt-1 text-xs text-steel-500">{RECON_STATUS[l.status]}{l.cause && ` · ${CAUSES[l.cause]}`} · {isOpen ? "tutup" : "detail"}</div>
                  </button>
                  {isOpen && <div className="mt-3 border-t border-steel-100 pt-3"><SkuDetail l={l} moves={movesBySku.get(l.sku) ?? []} run={run} person={person} editable={editable} /></div>}
                </div>
              );
            })}
          </div>
          )}
        </>
      )}
    </div>
  );
}

function FlagChips({ l }: { l: ReconLine }) {
  const f = flags(l);
  if (!f.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {f.map((x) => <span key={x} className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", x === "UOM" || x === "NO_MASTER" ? "bg-bad/15 text-bad" : "bg-steel-100 text-steel-700")}>{FLAG_LABEL[x]}</span>)}
    </div>
  );
}

type BinLine = { bin_code: string; zone: string; batch_lot: string; expiry_date: string | null; quantity: number; held: number; bin_status: string };
type WmsMove = { created_at: string; type: string; quantity: number; batch_lot: string; note: string | null; by_name: string | null;
  from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null };

/** One SKU opened: the numbers, our bins, the SAP and WMS transactions, and the handling. */
function SkuDetail({ l, moves, run, person, editable }: { l: ReconLine; moves: SapMove[]; run: ReconSummary; person: string; editable: boolean }) {
  const [bins, setBins] = useState<BinLine[] | null>(null);
  const [wms, setWms] = useState<WmsMove[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const days = moves.map((m) => m.posting_date).filter((d): d is string => !!d).sort();
  const from = days[0] ?? run.as_of, to = days[days.length - 1] ?? run.as_of;

  useEffect(() => {
    let live = true;
    void (async () => {
    const sb = createClient();
    const [b, m] = await Promise.all([
      sb.from("inventory_detail").select("bin_code, zone, batch_lot, expiry_date, quantity, held, bin_status").eq("sku", l.sku).order("bin_code"),
      l.item_id
        ? sb.from("movements").select("created_at, type, quantity, batch_lot, note, by_name, from_bin:bins!movements_from_bin_id_fkey(bin_code), to_bin:bins!movements_to_bin_id_fkey(bin_code)")
            .eq("item_id", l.item_id).gte("created_at", `${from}T00:00:00+07:00`).order("created_at", { ascending: false }).limit(200)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (!live) return;
    if (b.error || m.error) { setLoadErr((b.error ?? m.error)!.message); return; }
    setBins((b.data ?? []) as BinLine[]); setWms((m.data ?? []) as unknown as WmsMove[]);
    })();
    return () => { live = false; };
  }, [l.sku, l.item_id, from]);

  const h = hint(l);
  const sapIn = moves.filter((m) => num(m.quantity) > 0).reduce((s, m) => s + num(m.quantity), 0);
  const sapOut = moves.filter((m) => num(m.quantity) < 0).reduce((s, m) => s + num(m.quantity), 0);
  const binTotal = (bins ?? []).reduce((s, b) => s + num(b.quantity), 0);

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {([
          ["SAP bebas", num(l.sap_unrestricted)], ["SAP blok", num(l.sap_blocked)], ["WMS bebas", num(l.wms_unrestricted)], ["WMS blok", num(l.wms_blocked)],
          ["Pending GI", num(l.pending_gi)], ["GI otomatis", num(l.auto_gi)], ["Pending GR", num(l.pending_gr)], ["Selisih", gapTotal(l)],
        ] as const).map(([k, v]) => (
          <div key={k} className="rounded bg-white p-2"><div className="text-xs text-steel-500">{k}</div><div className="font-semibold tabular">{k === "Selisih" ? signed(v) : fmtNum(v)}</div></div>
        ))}
      </div>
      {h && <p className="rounded-md bg-plate/30 p-2">{h.text}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1 font-semibold">Stok WMS per bin {bins && <span className="font-normal text-steel-500">· {bins.length} baris · {fmtNum(binTotal)}</span>}</div>
          {loadErr && <p className="text-bad">{loadErr}</p>}
          {!bins && !loadErr && <p className="text-steel-500">Memuat…</p>}
          {bins && bins.length === 0 && <p className="text-steel-500">Tidak ada stok WMS untuk SKU ini.</p>}
          {bins && bins.length > 0 && (
            <div className="max-h-64 overflow-auto rounded bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white"><tr className="text-left text-steel-500"><th className="p-1">Bin</th><th className="p-1">Batch</th><th className="p-1">Expired</th><th className="p-1 text-right">Qty</th><th className="p-1 text-right">Ditahan</th></tr></thead>
                <tbody>{bins.map((b, i) => (
                  <tr key={i} className="border-t border-steel-100">
                    <td className="p-1"><Link className="font-semibold underline" href={`/bin/${encodeURIComponent(b.bin_code)}`}>{b.bin_code}</Link>{b.zone === "QUARANTINE" && <span className="ml-1 text-bad">karantina</span>}</td>
                    <td className="p-1">{b.batch_lot || "–"}</td><td className="p-1">{fmtDate(b.expiry_date)}</td>
                    <td className="p-1 text-right tabular">{fmtNum(num(b.quantity))}</td><td className="p-1 text-right tabular">{num(b.held) ? fmtNum(num(b.held)) : ""}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 font-semibold">Transaksi SAP (MB51) <span className="font-normal text-steel-500">· masuk +{fmtNum(sapIn)} · keluar {fmtNum(sapOut)}</span></div>
          {moves.length === 0 ? <p className="text-steel-500">Tidak ada transaksi MB51 untuk SKU ini.</p> : (
            <div className="max-h-64 overflow-auto rounded bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white"><tr className="text-left text-steel-500"><th className="p-1">Tgl</th><th className="p-1">Lok</th><th className="p-1">Mvt</th><th className="p-1 text-right">Qty</th><th className="p-1">Ref / DO</th></tr></thead>
                <tbody>{moves.map((m) => (
                  <tr key={m.line_no} className="border-t border-steel-100">
                    <td className="p-1 whitespace-nowrap">{fmtDate(m.posting_date)}</td><td className="p-1">{m.sloc}</td>
                    <td className="p-1">{m.mvt_type} {mvtLabel(m.mvt_type)}</td>
                    <td className={cn("p-1 text-right tabular", num(m.quantity) < 0 ? "text-bad" : "text-ok")}>{signed(num(m.quantity))}</td>
                    <td className="p-1">{m.reference ?? m.mat_doc}{m.customer_name && <div className="text-steel-500">{m.customer_name}</div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 font-semibold">Mutasi WMS sejak {fmtDate(from)} {wms && <span className="font-normal text-steel-500">· {wms.length} baris</span>}
          {l.item_id && <Link className="ml-2 font-normal underline" href={`/movements?sku=${l.sku}&from=${from}${to !== from ? `&to=${to}` : ""}`}>buka di Mutasi</Link>}</div>
        {wms && wms.length === 0 && <p className="text-steel-500">Tidak ada mutasi WMS di tanggal itu.</p>}
        {wms && wms.length > 0 && (
          <div className="max-h-48 overflow-auto rounded bg-white">
            <table className="w-full text-xs"><tbody>{wms.map((m, i) => (
              <tr key={i} className="border-t border-steel-100 first:border-0">
                <td className="p-1 whitespace-nowrap">{fmtDateTime(m.created_at)}</td><td className="p-1">{m.type}</td>
                <td className="p-1">{m.from_bin?.bin_code ?? ""}{m.from_bin && m.to_bin ? " → " : ""}{m.to_bin?.bin_code ?? ""}</td>
                <td className="p-1 text-right tabular">{fmtNum(num(m.quantity))}</td><td className="p-1 text-steel-500">{m.by_name}{m.note && ` · ${m.note}`}</td>
              </tr>
            ))}</tbody></table>
          </div>
        )}
      </div>

      <LineEditor l={l} person={person} editable={editable} suggested={h?.cause ?? null} />
    </div>
  );
}

function LineEditor({ l, person, editable, suggested }: { l: ReconLine; person: string; editable: boolean; suggested: CauseCode | null }) {
  const router = useRouter();
  const [status, setStatus] = useState(l.status);
  const [cause, setCause] = useState<CauseCode | "">(l.cause ?? "");
  const [remark, setRemark] = useState(l.remark ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const d = direction(l);
  if (!editable) {
    return <p className="text-xs">Penanganan: {RECON_STATUS[l.status]}{l.cause && ` · ${CAUSES[l.cause]}`}{l.remark && ` · ${l.remark}`}{l.updated_by_name && ` (${l.updated_by_name})`}</p>;
  }

  async function save() {
    const { error } = await createClient().rpc("explain_recon_line", { p_line_id: l.id, p_status: status, p_cause: cause || null, p_remark: remark, p_by_name: person });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Tersimpan" });
    if (!error) router.refresh();
  }
  async function recount() {
    const { data, error } = await createClient().rpc("request_recon_counts", { p_line_id: l.id, p_by_name: person });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: `${(data as { count_tasks: number }).count_tasks} tugas hitung dibuat` });
    if (!error) router.refresh();
  }

  return (
    <div className="space-y-2 rounded-md border border-steel-200 bg-white p-2">
      <div className="font-semibold">Penanganan {d !== "MATCH" && <GapBadge gap={gapTotal(l)} className="ml-1" />}</div>
      <div className="grid gap-2 md:grid-cols-[11rem_16rem_1fr]">
        <Select aria-label={`Status ${l.sku}`} value={status} onChange={(e) => setStatus(e.target.value as ReconLine["status"])}>
          {Object.entries(RECON_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label={`Penyebab ${l.sku}`} value={cause} onChange={(e) => setCause(e.target.value as CauseCode | "")}>
          <option value="">Penyebab…</option>{Object.entries(CAUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input aria-label={`Keterangan ${l.sku}`} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Keterangan, mis. DO 538306981 belum GI" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={person.trim().length < 2}>Simpan</Button>
        {suggested && cause !== suggested && <Button size="sm" variant="ghost" onClick={() => setCause(suggested)}>Pakai saran: {CAUSES[suggested]}</Button>}
        {l.item_id && hasGap(l) && <Button size="sm" variant="outline" onClick={recount} disabled={person.trim().length < 2}>Minta hitung ulang</Button>}
        {person.trim().length < 2 && <span className="text-xs text-warn">Isi nama Anda di atas dulu.</span>}
        {msg && <span className={cn("text-xs", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
      </div>
      {l.updated_by_name && <p className="text-xs text-steel-500">Terakhir diisi {l.updated_by_name} · {fmtDateTime(l.updated_at)}</p>}
    </div>
  );
}
