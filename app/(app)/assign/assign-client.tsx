"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { assignConfirm, canAssign, unassignConfirm, type BoardRow, type OperatorRow } from "@/lib/assign-board";
import { assignAction, unassignAction } from "./actions";

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "short", year: "numeric" });

function DayNav({ date, prevDate, nextDate }: { date: string; prevDate: string | null; nextDate: string | null }) {
  const router = useRouter();
  const arrow = (to: string | null, label: string, Icon: typeof ChevronLeft) => to
    ? <Link href={`/assign?date=${to}`} aria-label={label} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-steel-100"><Icon className="h-5 w-5" /></Link>
    : <span className="inline-flex h-11 w-11 items-center justify-center text-steel-300" aria-hidden><Icon className="h-5 w-5" /></span>;
  return (
    <div className="flex items-center gap-1">
      {arrow(prevDate, "Hari rencana sebelumnya", ChevronLeft)}
      <span className="whitespace-nowrap font-cond text-lg font-semibold capitalize">{dayLabel(date)}</span>
      {arrow(nextDate, "Hari rencana berikutnya", ChevronRight)}
      <label className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md hover:bg-steel-100" title="Pilih tanggal">
        <CalendarDays className="h-5 w-5" />
        <span className="sr-only">Pilih tanggal</span>
        <input type="date" value={date} className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => e.target.value && router.push(`/assign?date=${e.target.value}`)} />
      </label>
    </div>
  );
}

const STATUS_STYLE: Record<BoardRow["status"], string> = {
  Belum: "bg-steel-100 text-steel-500", Dipicking: "bg-plate/40 text-steel", Selesai: "bg-ckb-tint text-steel", Dimuat: "bg-ckb-tint text-steel",
};

/** Dropdown + Tugaskan / Ganti, and Lepas, for one shipment. */
function RowActions({ row, date, operators, person, onPerson }: {
  row: BoardRow; date: string; operators: OperatorRow[]; person: string; onPerson: (v: string) => void;
}) {
  const [pick, setPick] = useState("");
  const router = useRouter();
  if (!canAssign(row.status)) return <span className="text-sm text-steel-500">{row.user_name ?? "-"}</span>;
  const chosen = operators.find((o) => o.id === pick);
  const nameField = <PersonNameField id={`assign-name-${row.wave_id}-${row.shipment_number}`} value={person} onChange={onPerson} label="Nama Anda" />;
  const done = (err: string | null) => { if (!err) router.refresh(); return err; };
  const needName = person.trim().length < 2 ? "Isi nama Anda dulu." : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {row.user_id
        ? <span className="text-sm font-semibold">{row.user_name}</span>
        : <span className="text-sm text-steel-500">Belum ditugaskan</span>}
      <Select aria-label={`Operator untuk shipment ${row.shipment_number}`} value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 w-44">
        <option value="">pilih operator</option>
        {operators.filter((o) => o.id !== row.user_id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      {chosen && (
        <ConfirmButton size="sm" title={row.user_id ? "Ganti operator" : "Tugaskan shipment"} summary={assignConfirm(row.shipment_number, chosen.name)}
          confirmLabel={row.user_id ? "Ganti" : "Tugaskan"} extra={nameField}
          onConfirm={async () => needName ?? done(await assignAction(date, row.shipment_number, chosen.id, person))}>
          {row.user_id ? "Ganti" : "Tugaskan"}
        </ConfirmButton>
      )}
      {row.user_id && (
        <ConfirmButton size="sm" variant="outline" title="Lepas shipment" summary={unassignConfirm(row.shipment_number, row.user_name ?? "")}
          confirmLabel="Lepas" extra={nameField}
          onConfirm={async () => needName ?? done(await unassignAction(date, row.shipment_number, person))}>
          Lepas
        </ConfirmButton>
      )}
    </div>
  );
}

export function AssignClient({ date, prevDate, nextDate, rows, operators }: {
  date: string; prevDate: string | null; nextDate: string | null; rows: BoardRow[]; operators: OperatorRow[];
}) {
  const [person, setPerson] = usePersonName();
  const status = (s: BoardRow["status"]) => <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[s])}>{s}</span>;
  const actions = (r: BoardRow) => <RowActions row={r} date={date} operators={operators} person={person} onPerson={setPerson} />;
  return (
    <>
      <div className="rounded-lg bg-white p-4"><DayNav date={date} prevDate={prevDate} nextDate={nextDate} /></div>
      <p className="rounded-lg bg-white p-4 text-sm">
        <span className="font-semibold">Operator:</span>{" "}
        {operators.length === 0 ? "belum ada akun Operator / Picker aktif" : operators.map((o, i) => (
          <span key={o.id}>{i > 0 && " · "}{o.name} <span className="tabular text-steel-500">{o.open_count} open</span></span>
        ))}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-center text-steel-500">Tidak ada shipment pada tanggal ini.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg bg-white lg:block">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-steel-100 text-left text-steel-500">
                {["NO", "Shipment", "Slot", "Truck", "FL", "HP", "Status", "Operator"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.wave_id}|${r.shipment_number}`} className="border-b border-steel-100 last:border-0">
                    <td className="px-3 py-2 tabular">{r.wave_no}</td>
                    <td className="px-3 py-2 tabular font-semibold">{r.shipment_number}</td>
                    <td className="px-3 py-2 tabular">{r.planned_slot ?? "-"}</td>
                    <td className="px-3 py-2">{r.truck ?? "-"}</td>
                    <td className="px-3 py-2 tabular">{r.fl_lines}</td>
                    <td className="px-3 py-2 tabular">{r.hp_lines}</td>
                    <td className="px-3 py-2">{status(r.status)}</td>
                    <td className="px-3 py-2">{actions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 lg:hidden">
            {rows.map((r) => (
              <div key={`${r.wave_id}|${r.shipment_number}`} className="space-y-2 rounded-lg bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold tabular">NO {r.wave_no} · {r.shipment_number}</p>
                  {status(r.status)}
                </div>
                <p className="text-sm text-steel-500 tabular">{r.planned_slot ?? "-"} · {r.truck ?? "-"} · FL {r.fl_lines} · HP {r.hp_lines}</p>
                {actions(r)}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
