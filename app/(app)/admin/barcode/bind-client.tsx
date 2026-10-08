"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";

const CameraScanner = dynamic(() => import("@/components/scan/camera-scanner").then((m) => m.CameraScanner), { ssr: false });

export type BindItem = {
  sku: string; description: string; uom: string | null; ean: string | null;
};

/** The same normalization the database applies: no whitespace, upper case. */
export function normBarcode(s: string): string {
  return s.replace(/\s/g, "").toUpperCase();
}

type Resolution =
  | { kind: "idle" }
  | { kind: "unknown"; code: string }
  | { kind: "owner"; code: string; sku: string }        // already another SKU's barcode
  | { kind: "skuCollision"; code: string; sku: string }; // equals another SKU's SKU code

/**
 * Bind a carton barcode to one SKU. Ownership is judged by EAN only (a code
 * that equals another SKU's SKU code is refused too, because a scan matches
 * both). The bind goes through bind_barcode, which stores exactly the
 * normalized value and keeps an append-only log.
 */
export function BindBarcodeClient({ items }: { items: BindItem[] }) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [resolution, setResolution] = useState<Resolution>({ kind: "idle" });
  const [chosen, setChosen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);

  const bySku = useMemo(() => new Map(items.map((i) => [i.sku, i])), [items]);
  const missing = useMemo(() => items.filter((i) => !i.ean), [items]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => `${i.sku} ${i.description}`.toLowerCase().includes(s)) : missing;
  }, [items, missing, q]);

  const chosenItem = chosen ? bySku.get(chosen) : undefined;
  const alreadyOwned = !!chosenItem && resolution.kind === "unknown" && normBarcode(chosenItem.ean ?? "") === resolution.code;

  /** Ownership by EAN only, plus a guard against a code equal to another SKU's SKU code. */
  function evaluate(raw: string, sku: string | null): Resolution {
    const c = normBarcode(raw);
    if (!c) return { kind: "idle" };
    const owner = items.find((i) => normBarcode(i.ean ?? "") === c);
    if (owner && owner.sku !== sku) return { kind: "owner", code: c, sku: owner.sku };
    const collide = items.find((i) => i.sku === c && i.sku !== sku);
    if (collide) return { kind: "skuCollision", code: c, sku: collide.sku };
    return { kind: "unknown", code: c };
  }

  function scan(raw: string) {
    const c = normBarcode(raw);
    setCode(c);
    setMsg(null);
    setResolution(evaluate(c, chosen));
  }

  function choose(sku: string) {
    const next = sku || null;
    setChosen(next);
    setMsg(null);
    if (code) setResolution(evaluate(code, next));
    scanRef.current?.focus();
  }

  async function saveBinding(): Promise<string | null> {
    if (resolution.kind !== "unknown" || !chosen) return "Pilih SKU dulu.";
    const { error } = await createClient().rpc("bind_barcode", { p_sku: chosen, p_code: resolution.code });
    if (error) return error.message;
    setMsg({ ok: true, text: `Barcode ${resolution.code} terikat ke SKU ${chosen}.` });
    setCode(""); setChosen(null); setResolution({ kind: "idle" });
    router.refresh();
    scanRef.current?.focus();
    return null;
  }

  async function clearBinding(sku: string): Promise<string | null> {
    const { error } = await createClient().rpc("bind_barcode", { p_sku: sku, p_code: null });
    if (error) return error.message;
    setMsg({ ok: true, text: `Barcode SKU ${sku} dikosongkan.` });
    setCode(""); setChosen(null); setResolution({ kind: "idle" });
    router.refresh();
    return null;
  }

  const bindSummary = chosenItem?.ean
    ? `Ganti barcode SKU ${chosenItem.sku} dari ${chosenItem.ean} ke ${resolution.kind === "unknown" ? resolution.code : code}.`
    : `Ikat barcode ${resolution.kind === "unknown" ? resolution.code : code} ke SKU ${chosenItem?.sku ?? ""}.`;

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <p className="max-w-3xl text-sm text-steel-500">
        Pindai barcode karton, lalu pilih SKU-nya. Barcode yang sudah dipakai SKU lain — atau yang sama dengan kode SKU
        lain — ditolak dan pemiliknya ditampilkan. Nilai disimpan persis seperti yang dipindai: tanpa spasi, huruf besar.
      </p>

      <Card>
        <CardContent className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label htmlFor="barcode">Barcode karton</Label>
              <div className="flex gap-1">
                <Input id="barcode" ref={scanRef} autoFocus value={code} inputMode="numeric" placeholder="Pindai / ketik lalu Enter"
                  onChange={(e) => { setCode(e.target.value); setResolution({ kind: "idle" }); setMsg(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scan((e.target as HTMLInputElement).value); } }} />
                <Button type="button" size="icon" variant="outline" aria-label="Pindai dengan kamera" onClick={() => setCamera((c) => !c)}><Camera className="h-4 w-4" /></Button>
              </div>
              {camera && <div className="mt-2"><CameraScanner onResult={(t) => { setCamera(false); scan(t); }} /></div>}
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
            <div className="rounded-md bg-plate/40 px-3 py-2 text-sm text-steel">
              Barcode <b>{resolution.code}</b> belum dipakai. {chosen ? <>Akan diikat ke <b>{chosen}</b>.</> : "Pilih SKU tujuan lalu tekan Ikat barcode."}
            </div>
          )}
          {resolution.kind === "owner" && (
            <div className="rounded-md bg-bad px-3 py-2 text-sm text-white">
              Barcode <b>{resolution.code}</b> sudah dipakai SKU <b>{resolution.sku}</b>
              {bySku.get(resolution.sku) ? ` — ${bySku.get(resolution.sku)!.description}` : ""}. Tidak bisa diikat.
            </div>
          )}
          {resolution.kind === "skuCollision" && (
            <div className="rounded-md bg-bad px-3 py-2 text-sm text-white">
              Barcode <b>{resolution.code}</b> sama dengan kode SKU <b>{resolution.sku}</b>. Tidak bisa diikat.
            </div>
          )}
          {alreadyOwned && <div className="rounded-md bg-steel-100 px-3 py-2 text-sm text-steel-700">SKU ini sudah memakai barcode tersebut.</div>}
          {msg && <div className={cn("rounded-md px-3 py-2 text-sm", msg.ok ? "bg-ok text-white" : "bg-bad text-white")}>{msg.text}</div>}

          {resolution.kind === "unknown" && chosen && !alreadyOwned ? (
            <ConfirmButton title="Ikat barcode" summary={bindSummary} confirmLabel="Ikat" onConfirm={saveBinding}>Ikat barcode</ConfirmButton>
          ) : (
            <Button disabled>Ikat barcode</Button>
          )}
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
              <tr key={i.sku} className={chosen === i.sku ? "bg-plate/40" : undefined}>
                <Td className="font-semibold">{i.sku}</Td>
                <Td>{i.description}</Td>
                <Td>{i.uom ?? "—"}</Td>
                <Td>{i.ean ?? <span className="text-steel-500">belum ada</span>}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => choose(i.sku)}>Pilih</Button>
                  {i.ean && (
                    <ConfirmButton size="sm" variant="outline" className="ml-2" title="Kosongkan barcode"
                      summary={`Hapus barcode ${i.ean} dari SKU ${i.sku}?`} confirmLabel="Kosongkan"
                      onConfirm={() => clearBinding(i.sku)}>Kosongkan</ConfirmButton>
                  )}
                </Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
