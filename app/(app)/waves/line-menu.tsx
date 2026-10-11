import { Undo2 } from "lucide-react";
import { ConfirmButton } from "@/components/app/confirm-button";
import { ActionMenu, MenuDanger, MenuNote, MenuSection } from "@/components/app/action-menu";
import { fmtNum } from "@/lib/utils";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import type { pairMoves } from "@/lib/allocator/pair-moves";
import { TaskPostDialog } from "./task-post-dialog";
import { PairPostDialog } from "./pair-post-dialog";
import { AddMoveButton, EditRowButton, FixButton, SplitButton, UnpostButton, UnpostPairButton } from "./wave-corrections";
import { PostMoveEarlyButton } from "./post-move-early";
import { RowHistory } from "./row-history";
import { CancelButton, WaitNotice, type Rpc, type TaskWait } from "./wave-parts";

/**
 * One wave line's actions (redesign): the one thing a person does next stays visible
 * (`LinePrimary`: Posting, or the wait notice), everything else lives in the line's menu
 * (`LineMenu`). The conditions are the ones PairAction / TaskAction used before, unchanged.
 */

export type LineItem = ReturnType<typeof pairMoves<TaskRow>>[number];
export type LineProps = {
  item: LineItem; label: string; isShort: boolean; wait?: TaskWait;
  canPost: boolean; canUndo: boolean; canRestore: boolean; supervisor: boolean; rpc: Rpc; onDone: () => void;
};

export function LinePrimary({ item, isShort, wait, canPost, supervisor, rpc, onDone }: LineProps) {
  const head = item.kind === "pair" ? item.pick : item.task;
  if (head.status !== "PLANNED" || !canPost) return null;
  const sku = head.sku;
  if (wait) return <WaitNotice wait={wait} sku={sku} supervisor={supervisor} rpc={rpc} />;
  return (
    <div className="flex flex-col items-start gap-1">
      {item.kind === "pair" ? <PairPostDialog pick={item.pick} move={item.move} onDone={onDone} /> : <TaskPostDialog task={item.task} onDone={onDone} />}
      {isShort && <span className="text-xs font-semibold text-bad">Stok kurang</span>}
    </div>
  );
}

/** Which rows the line's menu has. Exported so the page can hide an empty menu. */
export function lineMenuRows({ item, isShort, canPost, canUndo, canRestore, supervisor, rpc }: LineProps) {
  const rows: { key: string; node: React.ReactNode; danger?: boolean }[] = [];
  if (item.kind === "pair") {
    const { pick, move } = item;
    const moveOnly = (
      <PostMoveEarlyButton moveId={move.id} sku={move.sku} to={move.to_bin ?? ""} rpc={rpc} label="Posting Bin To Bin saja"
        summary={`Posting hanya Bin To Bin #${pick.seq}: ${fmtNum(Number(move.quantity))} dari ${move.from_bin} ke ${move.to_bin} sekarang. Pick ${fmtNum(Number(pick.quantity))} untuk truk tetap belum dikerjakan dan diposting nanti.`} />
    );
    if (pick.status === "COMPLETED") {
      if (supervisor && canUndo) rows.push({ key: "unpost", node: <UnpostPairButton pick={pick} move={move} /> });
    } else {
      // Stok kurang: the proposal that makes this row doable again (lib/wave-fix.ts), also on a Tunda wave.
      if (isShort && supervisor && canRestore && pick.status === "PLANNED" && move.status === "PLANNED") rows.push({ key: "fix", node: <FixButton pick={pick} move={move} /> });
      // A Tunda wave cannot be worked on, but its pallet rest may still go to the pickface for the waves that need it (0053).
      if (pick.status === "PLANNED" && !canPost && canRestore && supervisor && move.status === "PLANNED") rows.push({ key: "move", node: moveOnly });
      if (pick.status === "PLANNED" && canPost && supervisor) {
        rows.push({ key: "post-edit", node: <EditRowButton pick={pick} move={move} mode="post" /> });
        rows.push({ key: "edit", node: <EditRowButton pick={pick} move={move} /> });
        if (move.status === "PLANNED") rows.push({ key: "move", node: moveOnly });
        // A pair is one picklist line: cancelling takes the pick and its leftover move together.
        if (canRestore) rows.push({ key: "cancel", danger: true, node: <CancelButton run={async () => {
          const e1 = await rpc("set_task_status", { p_task_id: pick.id, p_status: "CANCELLED" });
          if (e1) return e1;
          if (move.status !== "COMPLETED") {
            const e2 = await rpc("set_task_status", { p_task_id: move.id, p_status: "CANCELLED" });
            if (e2) return `Pick dibatalkan, pindahan sisa gagal: ${e2}`;
          }
          return null;
        }} /> });
      }
    }
  } else {
    const t = item.task;
    if (t.status === "CANCELLED") {
      // A task cancelled by mistake goes back to the plan (set_task_status allows CANCELLED -> PLANNED).
      if (supervisor && canRestore) rows.push({ key: "restore", node: (
        <ConfirmButton size="sm" variant="ghost" title={`Pulihkan tugas #${t.seq}`} confirmLabel="Pulihkan"
          summary={`Tugas #${t.seq} (${fmtNum(Number(t.quantity))} ${t.uom ?? ""} SKU ${t.sku} dari ${t.from_bin}) kembali ke rencana dan bisa diposting lagi. Pakai hanya bila dibatalkan tidak sengaja: jika jumlah order sudah diubah, tugas ini bisa membuat pick lebih.`}
          onConfirm={() => rpc("set_task_status", { p_task_id: t.id, p_status: "PLANNED", p_reason: "dipulihkan: dibatalkan tidak sengaja" })}>
          <Undo2 className="h-4 w-4" />Pulihkan</ConfirmButton>
      ) });
    } else if (t.status === "COMPLETED") {
      if (supervisor && canUndo) rows.push({ key: "unpost", node: <UnpostButton task={t} /> });
      // A pick without a Bin To Bin can get one (0045); it then pairs with the pick.
      if (supervisor && t.task_type === "PICK" && canRestore) rows.push({ key: "add-move", node: <AddMoveButton task={t} /> });
    } else {
      if (isShort && supervisor && canRestore && t.task_type === "PICK" && t.status === "PLANNED") rows.push({ key: "fix", node: <FixButton pick={t} /> });
      if (t.status === "PLANNED" && canPost && supervisor) {
        if (t.task_type === "PICK") rows.push({ key: "post-edit", node: <EditRowButton pick={t} mode="post" /> });
        if (t.task_type === "PICK") rows.push({ key: "edit", node: <EditRowButton pick={t} /> });
        if (t.task_type === "PICK" && Number(t.quantity) > 1) rows.push({ key: "split", node: <SplitButton task={t} /> });
        rows.push({ key: "cancel", danger: true, node: <CancelButton run={() => rpc("set_task_status", { p_task_id: t.id, p_status: "CANCELLED" })} /> });
      }
    }
  }
  return rows;
}

export function LineMenu(props: LineProps & { open?: boolean; onOpenChange?: (o: boolean) => void; trigger?: React.ReactNode }) {
  const { item, label } = props;
  const ids = item.kind === "pair" ? [item.pick.id, item.move.id] : [item.task.id];
  const rows = lineMenuRows(props);
  const main = rows.filter((r) => !r.danger);
  const danger = rows.filter((r) => r.danger);
  return (
    <ActionMenu title={label} open={props.open} onOpenChange={props.onOpenChange} trigger={props.trigger}>
      <MenuSection>
        {main.map((r) => <div key={r.key}>{r.node}</div>)}
        <div><RowHistory ids={ids} label={label} /></div>
      </MenuSection>
      {main.length === 0 && <MenuNote>Tidak ada aksi lain untuk baris ini.</MenuNote>}
      {danger.length > 0 && <MenuDanger>{danger.map((r) => <div key={r.key}>{r.node}</div>)}</MenuDanger>}
    </ActionMenu>
  );
}
