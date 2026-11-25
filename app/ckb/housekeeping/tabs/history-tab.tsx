"use client";
import { useState } from "react";
import { Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { HK_STATE, dateLabel, dayFull } from "@/lib/ckb/housekeeping";
import { DayPanel, type DayTarget } from "../day-panel";
import type { MyDay } from "./today-tab";

/** The PIC's last 30 days: what was sent, what was rejected and why, and what was missed past the late window. */
export function HistoryTab({ rows, today }: { rows: MyDay[]; today: string }) {
  const [open, setOpen] = useState<DayTarget | null>(null);
  const shown = rows.filter((r) => r.day < today && !["FUTURE", "NA", "HOLIDAY"].includes(r.state))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.area_code.localeCompare(b.area_code)));
  if (!shown.length) return <p className="rounded-lg border border-dashed border-steel-300 bg-white p-6 text-center text-sm text-steel-500">Belum ada riwayat 30 hari terakhir.</p>;
  return (
    <div className="space-y-2">
      {shown.map((r) => {
        const st = HK_STATE[r.state];
        return (
          <div key={`${r.area_id}|${r.day}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-steel-100 bg-white p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-cond text-lg font-bold">{r.area_code}</span>
                <span className="text-sm">{dayFull(r.day)}</span>
                <Pill tone={st.tone}>{st.mark} {st.label}</Pill>
                {r.late && r.state === "DONE" && <Pill tone="warn">Terlambat</Pill>}
              </div>
              {r.review_note && <p className="mt-1 text-xs text-bad">Ditolak: {r.review_note}</p>}
            </div>
            {r.checkin_id && <Button size="sm" variant="outline" onClick={() => setOpen({ areaId: r.area_id, areaCode: r.area_code, areaName: r.area_name, day: r.day, isLead: false })}>Lihat foto</Button>}
          </div>
        );
      })}
      <DayPanel target={open} onClose={() => setOpen(null)} />
    </div>
  );
}
