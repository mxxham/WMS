"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CameraScanner = dynamic(() => import("@/components/scan/camera-scanner").then((m) => m.CameraScanner), { ssr: false });

export type ScannedItem = { sku: string; description: string; uom: string | null; upp: number | null };

/**
 * SKU field that also takes a carton barcode: a USB scanner types the code
 * and Enter, the phone camera reads it, or the SKU is typed. The code is
 * resolved against the item master (SKU or EAN, item_by_barcode).
 */
export function ItemScanInput({ value, onChange, onItem, id, placeholder = "SKU / scan barcode", autoFocus }: {
  value: string; onChange: (v: string) => void; onItem?: (item: ScannedItem | null) => void;
  id?: string; placeholder?: string; autoFocus?: boolean;
}) {
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(code: string) {
    const c = code.trim();
    if (!c) return;
    const { data, error: e } = await createClient().rpc("item_by_barcode", { p_code: c });
    if (e) return setError(e.message);
    const item = ((data ?? []) as ScannedItem[])[0] ?? null;
    setError(item ? null : `${c} tidak dikenal: bukan SKU atau barcode di master item`);
    if (item) onChange(item.sku);
    onItem?.(item);
  }

  return (
    <div>
      <div className="flex gap-1">
        <Input id={id} aria-label="SKU" value={value} autoFocus={autoFocus} placeholder={placeholder} inputMode="numeric"
          onChange={(e) => { onChange(e.target.value); setError(null); }}
          onBlur={(e) => resolve(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolve((e.target as HTMLInputElement).value); } }} />
        <Button type="button" size="icon" variant="outline" aria-label="Scan barcode dengan kamera" onClick={() => setCamera((c) => !c)}><Camera className="h-4 w-4" /></Button>
      </div>
      {camera && <div className="mt-2"><CameraScanner onResult={(t) => { setCamera(false); onChange(t); resolve(t); }} /></div>}
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
