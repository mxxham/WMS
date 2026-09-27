"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LABEL, LEVEL_COLORS, STRIP_LEVEL_ORDER } from "@/config/warehouse";
import { fmtDateTime } from "@/lib/utils";

type Scope = "bins" | "rack" | "zone";
type Log = { id: number; bin_ids: string[]; printed_at: string; note: string | null; profiles: { name: string } | null };

export function LabelsClient({ racks, logs }: { racks: Record<string, string[]>; logs: Log[] }) {
  const router = useRouter();
  const zones = Object.keys(racks);
  const [scope, setScope] = useState<Scope>("rack");
  const [zone, setZone] = useState(zones[0] ?? "");
  const [rack, setRack] = useState(racks[zones[0]]?.[0] ?? "");
  const [codes, setCodes] = useState("");
  const [layout, setLayout] = useState<"strip" | "cell">("strip");
  const [colorMode, setColorMode] = useState<"color" | "mono">("color");
  const [includeCode128, setCode128] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true); setError(null);
    const body =
      scope === "bins" ? { scope, codes: codes.split(/[\s,;]+/) }
      : scope === "rack" ? { scope, zone, rack } : { scope, zone };
    const res = await fetch("/api/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, layout, colorMode, includeCode128 }) });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => null))?.error ?? "Gagal membuat PDF.");
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
    router.refresh(); // show the new print log entry
  }

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-[1fr_22rem] lg:p-8">
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Bin yang dicetak</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {([["rack", "Satu rak"], ["zone", "Satu aisle/area"], ["bins", "Daftar bin"]] as const).map(([v, l]) => (
                <Button key={v} variant={scope === v ? "default" : "outline"} onClick={() => setScope(v)}>{l}</Button>
              ))}
            </div>
            {scope !== "bins" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="zone">Aisle / area</Label>
                  <Select id="zone" value={zone} onChange={(e) => { setZone(e.target.value); setRack(racks[e.target.value]?.[0] ?? ""); }}>
                    {zones.map((z) => <option key={z}>{z}</option>)}
                  </Select></div>
                {scope === "rack" && (
                  <div><Label htmlFor="rack">Rak</Label>
                    <Select id="rack" value={rack} onChange={(e) => setRack(e.target.value)} disabled={!racks[zone]?.length}>
                      {(racks[zone] ?? []).map((r) => <option key={r}>{r}</option>)}
                    </Select></div>
                )}
              </div>
            )}
            {scope === "bins" && (
              <div><Label htmlFor="codes">Kode bin (pisahkan dengan spasi, koma, atau baris baru)</Label>
                <textarea id="codes" rows={4} value={codes} onChange={(e) => setCodes(e.target.value)} className="w-full rounded-md border border-steel-300 p-2 font-mono text-sm" placeholder={"CA01A01\nCA01B01"} /></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Format</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">Tata letak</legend>
              <label className="flex gap-2"><input type="radio" checked={layout === "strip"} onChange={() => setLayout("strip")} />
                <span><b>Strip tiang rak</b>: satu halaman per tiang, sel level {STRIP_LEVEL_ORDER.join(", ")} berurutan + panah atas/bawah. Lebar {LABEL.cellWidthMm} mm, tiap sel {LABEL.cellHeightMm} mm. Untuk roll kontinu.</span></label>
              <label className="flex gap-2"><input type="radio" checked={layout === "cell"} onChange={() => setLayout("cell")} />
                <span><b>Per sel</b>: satu label {LABEL.cellWidthMm}×{LABEL.cellHeightMm} mm per halaman, panah di pita kode. Untuk label die-cut.</span></label>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">Warna</legend>
              <label className="flex gap-2"><input type="radio" checked={colorMode === "color"} onChange={() => setColorMode("color")} />
                <span>Pita warna per level (
                  {STRIP_LEVEL_ORDER.map((l) => <span key={l} className="mx-0.5 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: LEVEL_COLORS[l].hex }} title={`Level ${l}: ${LEVEL_COLORS[l].name}`} />)}
                ) — butuh printer warna atau label pra-cetak berwarna.</span></label>
              <label className="flex gap-2"><input type="radio" checked={colorMode === "mono"} onChange={() => setColorMode("mono")} />
                <span>Hitam-putih — untuk printer thermal (pita hitam, teks putih).</span></label>
            </fieldset>
            <label className="flex gap-2"><input type="checkbox" checked={includeCode128} onChange={(e) => setCode128(e.target.checked)} />
              <span>Tambahkan barcode Code 128 (QR mengecil ke 34 mm)</span></label>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border-2 border-warn bg-warn/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Cetak di skala 100% / Actual size</p>
          <p className="mt-1">Matikan &quot;Fit to page&quot; di dialog print. Setel ukuran kertas driver ke {LABEL.cellWidthMm} mm lebar. Skala lain membuat QR mengecil dan susah discan.</p>
        </div>
        {error && <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">{error}</p>}
        <Button size="lg" className="w-full" onClick={generate} disabled={busy || (scope === "bins" && !codes.trim())}>
          <Printer className="h-5 w-5" />{busy ? "Membuat PDF…" : "Buat PDF label"}
        </Button>
        <Card>
          <CardHeader><CardTitle className="text-base">Riwayat cetak</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {logs.length === 0 ? <p className="text-steel-500">Belum ada.</p> : logs.map((l) => (
              <div key={l.id} className="border-b border-steel-100 pb-2 last:border-0">
                <div className="font-medium">{l.bin_ids.length} bin · {l.profiles?.name ?? "–"}</div>
                <div className="text-xs text-steel-500">{fmtDateTime(l.printed_at)} · {l.note}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
