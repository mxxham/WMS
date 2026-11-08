"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { binSummaryRows, changeSheetRows, changesFileName, type LocationChange } from "@/lib/location-changes";
import { saveSheets } from "@/lib/save-xlsx";

/** Downloads exactly the rows on the page: one sheet per change, one per bin. */
export function DownloadLocationChanges({ rows, from, to, wave }: { rows: LocationChange[]; from: string; to: string; wave: string | null }) {
  const [error, setError] = useState<string | null>(null);
  function download() {
    setError(null);
    try {
      saveSheets({ "Perubahan lokasi": changeSheetRows(rows), "Per bin": binSummaryRows(rows) },
        changesFileName(from, to, wave), "tidak ada perubahan lokasi");
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button variant="outline" onClick={download}><Download className="h-4 w-4" />Unduh Excel</Button>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  );
}
