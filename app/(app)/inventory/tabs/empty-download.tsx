"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Row = Record<string, string | number | null>;

/** Downloads every empty bin matching the current filters (not only the rows shown) as one .xlsx. */
export function EmptyBinsDownload({ rows, filename }: { rows: Row[]; filename: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const { saveSheets } = await import("@/lib/save-xlsx");
      saveSheets({ "Bin kosong": rows }, filename, "tidak ada bin kosong");
    } finally { setBusy(false); }
  }
  return (
    <Button variant="outline" size="sm" onClick={download} disabled={busy || rows.length === 0}>
      <Download className="h-4 w-4" />{busy ? "Menyiapkan…" : "Unduh Excel"}
    </Button>
  );
}
