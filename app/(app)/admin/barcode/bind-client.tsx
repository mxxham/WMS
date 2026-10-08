"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";

const CameraScanner = dynamic(() => import("@/components/scan/camera-scanner").then((m) => m.CameraScanner), { ssr: false });

export type BindItem = {
  sku: string; description: string; uom: string | null;
  ean: string | null; shelf_life_months: number | null; min_dispatch_days: number | null;
};

/** The same normalization the database applies: no whitespace, upper case. */
export function normBarcode(s: string): string {
  return s.replace(/\s/g, "").toUpperCase();
}

type Resolution =
  | { kind: "idle" }
  | { kind: "unknown"; code: string }
  | { kind: "conflict"; code: string; sku: string };

/**
 * Bind a carton barcode to one SKU. Scan (or type) the code first: a code
 * already bound to another SKU is refused and that SKU is named. An unbound
 * code is tied to the chosen SKU through set_item_control, which stores
 * exactly the normalized value (no whitespace, upper case).
 */
export function BindBarcodeClient({ items }: { items: BindItem[] }) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [resolution, setResolution] = useState<Resolution>({ kind: "idle" });
  const [chosen, setChosen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);

  const bySku = useMemo(() => new Map(items.map((i) => [i.sku, i])), [items]);
  const missing = useMemo(() => items.filter((i) => !i.ean), [items]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => `${i.sku} ${i.description}`.toLowerCase().includes(s)) : missing;
  }, [items, missing, q]);

  async function resolve(raw: string) {
    const normalised = normBarcode(raw);
    setCode(normalised);
    setMsg(null);
    if (!normalised) { setResolution({ kind: "idle" }); return; }
    setBusy(true);
    const { data, error } = await createClient().rpc("barcode_lookup", { p_code: normalised });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    const row = ((data ?? []) as { outcome: string; sku: string | null }[])[0];
    if (row?.outcome === "UNKNOWN_BARCODE") setResolution({ kind: "unknown", code: normalised });
    else setResolution({ kind: "conflict", code: normalised, sku: row?.sku ?? "" });
  }

  async function bind() {
    if (resolution.kind !== "unknown" || !chosen) return;
    const item = bySku.get(chosen);
    if (!item) return;
    setBusy(true);
    // set_item_control also carries shelf life and dispatch minimum, so pass
    // the current values back rather than clearing them.
    const { error } = await createClient().rpc("set_item_control", {
      p_sku: item.sku,
      p_ean: resolution.code,
      p_shelf_life_months: item.shelf_life_months,
      p_min_dispatch_days: item.min_dispatch_days,
    });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: `Barcode ${resolution.code} terikat ke SKU ${item.sku}.` });
    setCode(""); setChosen(null); setResolution({ kind: "idle" });
    router.refresh();
    scanRef.current?.focus();
  }

  function choose(sku: string) { setChosen(sku || null); setMsg(null); scanRef.current?.focus(); }

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <p className="max-w-3xl text-sm text-steel-500">
        Pindai barcode karton, lalu pilih SKU-nya. Barcode yang sudah dipakai SKU lain ditolak dan SKU pemiliknya
        ditampilkan. Nilai disimpan persis seperti yang dipindai: tanpa spasi, huruf besar.
      </p>

      <Card>
        <CardContent className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label htmlFor="barcode">Barcode karton</Label>
              <div className="flex gap-1">
                <Input id="barcode" ref={scanRef} autoFocus value={code} inputMode="numeric" placeholder="Pindai / ketik lalu Enter"
                  onChange={(e) => { setCode(e.target.value); setResolution({ kind: "idle" }); setMsg(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolve((e.target as HTMLInputElement).value); } }} />
                <Button type="button" size="icon" variant="outline" aria-label="Pindai dengan kamera" onClick={() => setCamera((c) => !c)}><Camera className="h-4 w-4" /></Button>
              </div>
              {camera && <div className="mt-2"><CameraScanner onResult={(t) => { setCamera(false); void resolve(t); }} /></div>}
            </div>
            <div>
              <Label htmlFor="sku">SKU tujuan</Label>
              <Select id="sku" value={chosen ?? ""} onChange={(e) => choose(e.target.value)}>
                <option value="">— pilih SKU —</option>
                {items.map((i) => <option key={i.sku} value={i.sku}>{i.sku} — {i.description}{i.ean ? ` (sudah: ${i.ean})` : ""}</option>)}
              </Select>
            </div>
          </div>

          {resolution.kind === "unknown" && (
            <div className="rounded-md bg-plate px-3 py-2 text-sm text-steel">
              Barcode <b>{resolution.code}</b> belum dipakai. {chosen ? <>Akan diikat ke <b>{chosen}</b>.</> : "Pilih SKU tujuan lalu tekan Ikat barcode."}
            </div>
          )}
          {resolution.kind === "conflict" && (
            <div className="rounded-md bg-bad px-3 py-2 text-sm text-white">
              Barcode <b>{resolution.code}</b> sudah dipakai SKU <b>{resolution.sku}</b>
              {bySku.get(resolution.sku) ? ` — ${bySku.get(resolution.sku)!.description}` : ""}. Tidak bisa diikat.
            </div>
          )}
          {msg && <div className={cn("rounded-md px-3 py-2 text-sm", msg.ok ? "bg-ok text-white" : "bg-bad text-white")}>{msg.text}</div>}

          <Button onClick={bind} disabled={busy || resolution.kind !== "unknown" || !chosen}>Ikat barcode</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1"><Label htmlFor="q">Cari SKU</Label><Input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU atau deskripsi" /></div>
            <span className="pb-2 text-sm text-steel-500">{fmtNum(missing.length)} dari {fmtNum(items.length)} SKU belum punya barcode</span>
          </div>
          <Table sticky>
            <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th>UOM</Th><Th>Barcode</Th><Th /></tr></thead>
            <tbody>{shown.map((i) => (
              <tr key={i.sku} className={chosen === i.sku ? "bg-plate" : undefined}>
                <Td className="font-semibold">{i.sku}</Td>
                <Td>{i.description}</Td>
                <Td>{i.uom ?? "—"}</Td>
                <Td>{i.ean ?? <span className="text-steel-500">belum ada</span>}</Td>
                <Td><Button size="sm" variant="outline" onClick={() => choose(i.sku)}>Pilih</Button></Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
