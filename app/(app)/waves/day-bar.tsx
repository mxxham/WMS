import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn, fmtNum } from "@/lib/utils";
import type { DayStep } from "@/lib/wave-next-step";
import { WaveGuide } from "./guide";

/** "Jumat 20 Nov" — the day in the warehouse's own words. */
export function dayLabel(date: string) {
  return new Date(`${date}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "short" });
}

/** Previous / next planned day, and a calendar for any other. */
export function DayNav({ date, prevDate, nextDate, compact = false }: { date: string; prevDate: string | null; nextDate: string | null; compact?: boolean }) {
  const router = useRouter();
  const arrow = (to: string | null, label: string, Icon: typeof ChevronLeft) => to
    ? <Link href={`/waves?date=${to}`} aria-label={label} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-steel-100"><Icon className="h-5 w-5" /></Link>
    : <span className="inline-flex h-11 w-11 items-center justify-center text-steel-300" aria-hidden><Icon className="h-5 w-5" /></span>;
  return (
    <div className="flex items-center gap-1">
      {arrow(prevDate, "Hari rencana sebelumnya", ChevronLeft)}
      <h1 className={cn("font-cond font-semibold capitalize", compact ? "text-lg" : "text-2xl")}>{dayLabel(date)}</h1>
      {arrow(nextDate, "Hari rencana berikutnya", ChevronRight)}
      <label className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md hover:bg-steel-100" title="Pilih tanggal">
        <CalendarDays className="h-5 w-5" />
        <span className="sr-only">Pilih tanggal</span>
        <input type="date" value={date} className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => e.target.value && router.push(`/waves?date=${e.target.value}`)} />
      </label>
    </div>
  );
}

/** The day: where you are, how far, and the one most urgent thing. Desktop layout. */
export function DayBar({ date, prevDate, nextDate, posted, total, step, onStep, dayMenu }: {
  date: string; prevDate: string | null; nextDate: string | null; posted: number; total: number;
  step: DayStep; onStep: () => void; dayMenu: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DayNav date={date} prevDate={prevDate} nextDate={nextDate} />
        <div className="flex items-center gap-1"><WaveGuide variant="desktop" />{dayMenu}</div>
      </div>
      <p className="text-sm text-steel-500 tabular">{fmtNum(posted)}/{fmtNum(total)} baris diposting</p>
      <StepLine step={step} onStep={onStep} />
    </div>
  );
}

/** "Langkah berikutnya: …", clickable when it points somewhere. */
export function StepLine({ step, onStep }: { step: DayStep; onStep: () => void }) {
  const body = <><span className="font-semibold">Langkah berikutnya:</span> {step.text}</>;
  return step.target
    ? <button type="button" onClick={onStep} className="w-full rounded-md bg-ckb-tint/60 px-3 py-2 text-left text-sm text-steel hover:bg-ckb-tint">{body}</button>
    : <p className="rounded-md bg-ckb-tint/60 px-3 py-2 text-sm text-steel">{body}</p>;
}
