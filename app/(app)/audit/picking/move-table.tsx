import type { createClient } from "@/lib/supabase/server";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtNum, cn } from "@/lib/utils";
import { type LineState, type PickError, PICK_ERROR_LABEL } from "@/lib/pick-audit";
import { MoveBinCheck } from "./move-bin-check";

/** One posted Bin To Bin (REPLENISH) line from `pick_audit_move` (0088). */
export type MoveRow = {
  task_id: string; seq: number; sku: string; description: string; uom: string | null;
  from_bin: string; zone: string | null; to_bin: string; to_zone: string | null;
  batch_lot: string; expiry_date: string | null; planned_qty: number; moved_qty: number;
  deviation_reason: string | null; picked_by_name: string | null; bulk_posted: boolean;
  scanned_code: string | null; line_state: LineState; attempts: number;
  wave_id: string; wave_no: string; planned_date: string; wave_status: string;
  /** 0114: the count of what is left in the source bin */
  /** undefined until 0114 is on the database */
  from_state?: "TODO" | "OK" | "MISMATCH" | "AUTO_PASS"; from_attempts: number;
  from_checker: string | null; from_system: number | null; from_counted: number | null;
  from_found_sku: string | null; from_note: string | null; from_correction: boolean | null; from_audited_at: string | null;
};

/** One audit attempt of a move's destination (pick_audits): a blind audit (0088) or a rack count (0115). */
export type MoveAttemptView = {
  id: string; task_id: string; attempt_no: number; checker_name: string; found_sku: string; found_batch: string; found_expiry: string | null;
  counted_qty: number; damaged: boolean; expected_sku: string; expected_batch: string; expected_expiry: string | null; expected_qty: number;
  errors: PickError[]; result: "OK" | "MISMATCH"; note: string | null; resolution: string | null; resolved_by_name: string | null;
  resolved_at: string | null; resolution_note: string | null; created_at: string; legacy: boolean;
  method: "STAGING" | "RACK"; rack_system: number | null; rack_counted: number | null;
  /** recorded again by a supervisor after a mistaken save (Ubah) */
  correction?: boolean;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Posted Bin To Bin lines with their audit attempts, by wave or by date. A move CB05C01 -> CF05A01
 * belongs to both racks: CB counts what is left in the source bin (0114), CF what is in the destination (0115).
 */
export async function loadMoves(supabase: Supabase, by: { wave: string } | { date: string; zone?: string }) {
  let q = supabase.from("pick_audit_move").select("*");
  if ("wave" in by) q = q.eq("wave_id", by.wave);
  else {
    q = q.eq("planned_date", by.date).neq("wave_status", "CANCELLED");
    if (by.zone) q = q.or(`zone.eq.${by.zone},to_zone.eq.${by.zone}`);
  }
  const { data } = await q.order("wave_no").order("seq");
  const rows = (data ?? []) as MoveRow[];
  const ids = rows.map((m) => m.task_id);
  const attempts: MoveAttemptView[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: a } = await supabase.from("pick_audits").select("*").in("task_id", ids.slice(i, i + 200)).order("attempt_no");
    attempts.push(...((a ?? []) as MoveAttemptView[]).map((x) => ({ ...x, counted_qty: Number(x.counted_qty), expected_qty: Number(x.expected_qty) })));
  }
  // What the system holds of each SKU in each bin of a move now, shown like the rack count's "Sisa di bin".
  const binQty = new Map<string, number>();
  const fromBins = [...new Set(rows.flatMap((m) => [m.from_bin, m.to_bin]))];
  for (let i = 0; i < fromBins.length; i += 200) {
    const { data: stock } = await supabase.from("inventory_detail").select("bin_code, sku, quantity").in("bin_code", fromBins.slice(i, i + 200));
    for (const r of (stock ?? []) as { bin_code: string; sku: string; quantity: number }[]) {
      binQty.set(`${r.bin_code}|${r.sku}`, (binQty.get(`${r.bin_code}|${r.sku}`) ?? 0) + Number(r.quantity));
    }
  }
  return { rows, attempts, binQty };
}

const STATE_TONE: Record<string, string> = {
  AUTO_PASS: "text-steel-500", TODO: "text-steel-500", OK: "text-ok", MISMATCH: "text-bad", RESOLVED: "text-warn",
};
const LABEL: Record<string, string> = {
  TODO: "Belum dihitung", OK: "OK", MISMATCH: "Selisih", RESOLVED: "Diterima supervisor", AUTO_PASS: "Tidak dipindah (0)",
};

/**
 * Bin To Bin lines. Each line has two rack-style counts: the source bin (Dari bin) and the destination
 * bin (Ke bin), each showing the system's quantity of the SKU there. With `zone` (a rack page) only the
 * sides in that rack show.
 */
export function MoveTable({ rows, attempts, binQty, supervisor, zone, showWave = false }: {
  rows: MoveRow[]; attempts: MoveAttemptView[]; binQty: Map<string, number>; supervisor: boolean;
  zone?: string;
  /** a rack's moves come from several waves */
  showWave?: boolean;
}) {
  const byTask = new Map<string, MoveAttemptView[]>();
  for (const a of attempts) byTask.set(a.task_id, [...(byTask.get(a.task_id) ?? []), a]);
  return (
    <Table sticky>
      <thead>
        <tr>
          {showWave && <Th>NO</Th>}
          <Th>#</Th>
          <Th>SKU</Th>
          <Th>Dari bin · sisa di bin</Th>
          <Th>Ke bin · isi di bin</Th>
          <Th>Petugas</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => {
          const hist = byTask.get(l.task_id) ?? [];
          const frozen = l.wave_status === "CANCELLED";
          const fromHere = !zone || l.zone === zone, showTo = !zone || l.to_zone === zone;
          const showFrom = fromHere && l.from_state !== undefined;
          const qty = binQty.get(`${l.from_bin}|${l.sku}`) ?? 0, toQty = binQty.get(`${l.to_bin}|${l.sku}`) ?? 0;
          return (
            <tr key={l.task_id} className={cn((l.line_state === "MISMATCH" && showTo || l.from_state === "MISMATCH" && showFrom) && "bg-bad/5")}>
              {showWave && <Td className="tabular text-xs">{l.wave_no}</Td>}
              <Td className="tabular">{l.seq}</Td>
              <Td>
                <span className="font-semibold">{l.sku}</span>
                <br />
                <span className="text-xs text-steel-500">{l.description}</span>
              </Td>
              <Td className={cn("space-y-1", !fromHere && "opacity-50")}>
                <div className="font-cond text-lg font-semibold">{l.from_bin}{l.zone && <span className="text-xs text-steel-500"> · rak {l.zone}</span>}</div>
                {showFrom && l.from_state ? <>
                  {l.from_state === "TODO" && <div className="text-lg font-bold tabular">{fmtNum(qty)} {l.uom ?? ""}</div>}
                  <div className={cn("text-xs font-semibold", STATE_TONE[l.from_state])}>{LABEL[l.from_state]}</div>
                  {l.from_audited_at && (
                    <p className="text-xs">
                      sisa {fmtNum(Number(l.from_counted))} · sistem {fmtNum(Number(l.from_system))} {l.uom ?? ""}
                      {l.from_found_sku && <span className="text-bad"> · ditemukan {l.from_found_sku}</span>}
                      {l.from_correction && " · ubah"}
                      <br /><span className="text-steel-500">{l.from_checker} · {when(l.from_audited_at)}{l.from_attempts > 1 ? ` · hitung ke-${l.from_attempts}` : ""}</span>
                      {l.from_note && <><br /><span className="text-steel-700">{l.from_note}</span></>}
                    </p>
                  )}
                  {!frozen && <MoveBinCheck side="FROM" taskId={l.task_id} seq={l.seq} bin={l.from_bin} sku={l.sku} uom={l.uom}
                    binQty={qty} state={l.from_state} supervisor={supervisor} />}
                </> : fromHere ? null : <p className="text-xs text-steel-500">dicek di rak {l.zone}</p>}
              </Td>
              <Td className={cn("space-y-1", !showTo && "opacity-50")}>
                <div className="font-cond text-lg font-semibold text-ckb">{l.to_bin}{l.to_zone && <span className="text-xs text-steel-500"> · rak {l.to_zone}</span>}</div>
                {showTo ? <>
                  {l.line_state === "TODO" && <div className="text-lg font-bold tabular">{fmtNum(toQty)} {l.uom ?? ""}</div>}
                  <div className={cn("text-xs font-semibold", STATE_TONE[l.line_state])}>{LABEL[l.line_state]}</div>
                  {hist.map((a) => <MoveAttemptLine key={a.id} a={a} uom={l.uom} />)}
                  {!frozen && <MoveBinCheck side="TO" taskId={l.task_id} seq={l.seq} bin={l.to_bin} sku={l.sku} uom={l.uom}
                    binQty={toQty} state={l.line_state} supervisor={supervisor} />}
                </> : <p className="text-xs text-steel-500">dicek di rak {l.to_zone}</p>}
              </Td>
              <Td className="text-xs">
                {l.picked_by_name ?? "(tidak tercatat)"}
                {l.bulk_posted && <span className="block text-warn">diposting massal</span>}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

const when = (s: string) => new Date(s).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function MoveAttemptLine({ a, uom }: { a: MoveAttemptView; uom: string | null }) {
  const rack = a.method === "RACK";
  return (
    <div className="rounded border border-steel-100 p-1.5 text-xs">
      <p>
        {a.result === "OK"
          ? <span className="font-semibold text-ok">OK</span>
          : <span className="font-semibold text-bad">{rack ? "Selisih" : a.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}</span>}
        {rack && <> · isi {fmtNum(Number(a.rack_counted))} · sistem {fmtNum(Number(a.rack_system))} {uom ?? ""}</>}
        {rack && a.found_sku !== a.expected_sku && <span className="text-bad"> · ditemukan {a.found_sku}</span>}
        {a.correction ? " · ubah" : ""}
        <br /><span className="text-steel-500">{a.checker_name} · {when(a.created_at)}{a.attempt_no > 1 ? ` · hitung ke-${a.attempt_no}` : ""}</span>
      </p>
      {!rack && a.result === "MISMATCH" && (
        <p className="text-steel-700">
          ditemukan {a.found_sku} · {fmtNum(a.counted_qty)} · batch {a.found_batch || "–"}
          {a.found_expiry ? ` · exp ${fmtDate(a.found_expiry)}` : ""}
          {a.damaged ? " · rusak" : ""}
        </p>
      )}
      {a.note && <p className="text-steel-700">{a.note}</p>}
      {a.resolution && a.resolved_at && (
        <p className="text-warn">
          {a.resolution === "ACCEPT_SHORT" ? "Terima kurang" : "Terima batch ini"} oleh {a.resolved_by_name} · {when(a.resolved_at)}: {a.resolution_note}
        </p>
      )}
    </div>
  );
}
