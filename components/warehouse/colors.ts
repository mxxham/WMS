import { NEAR_EXPIRY_DAYS, daysUntil } from "@/config/warehouse";
import type { BinSummary, ColorMode } from "@/lib/warehouse-types";

export const LEGENDS: Record<ColorMode, { label: string; color: string }[]> = {
  abc: [
    { label: "A (paling sering di-pick)", color: "#F9CF54" },
    { label: "B", color: "#5B8DB8" },
    { label: "C", color: "#8A96A0" },
    { label: "Kosong / belum ada kelas", color: "#E2E9E5" },
  ],
  fill: [
    { label: "Kosong", color: "#E2E9E5" },
    { label: "Sebagian (< 95%)", color: "#5B8DB8" },
    { label: "Penuh (≥ 95%)", color: "#135F45" },
    { label: "Melebihi kapasitas", color: "#C0392B" },
    { label: "UPP tidak diketahui", color: "#C9A7E0" },
  ],
  expiry: [
    { label: "Expired", color: "#C0392B" },
    { label: `≤ ${NEAR_EXPIRY_DAYS} hari`, color: "#D9941A" },
    { label: "Aman", color: "#2E7D4F" },
    { label: "Kosong", color: "#E2E9E5" },
    { label: "Tanpa tanggal", color: "#8A96A0" },
  ],
};

/** Colour of one bin in the selected mode. Empty bins stay pale so stock stands out. */
export function binColor(b: BinSummary, mode: ColorMode): string {
  const empty = Number(b.total_qty) === 0;
  if (mode === "abc") {
    if (empty || !b.abc_class) return "#E2E9E5";
    return b.abc_class === "A" ? "#F9CF54" : b.abc_class === "B" ? "#5B8DB8" : "#8A96A0";
  }
  if (mode === "fill") {
    if (empty) return "#E2E9E5";
    if (b.fill_ratio === null) return "#C9A7E0";
    const f = Number(b.fill_ratio);
    return f > 1.05 ? "#C0392B" : f >= 0.95 ? "#135F45" : "#5B8DB8";
  }
  if (empty) return "#E2E9E5";
  const d = daysUntil(b.min_expiry);
  if (d === null) return "#8A96A0";
  return d < 0 ? "#C0392B" : d <= NEAR_EXPIRY_DAYS ? "#D9941A" : "#2E7D4F";
}
