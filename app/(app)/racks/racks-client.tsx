"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "@/lib/types";
import { buildFloorPlan, narrowLevels, rackTiles, stateOf, type RackBin } from "@/lib/racks";
import { cn } from "@/lib/utils";
import { useIsPhone } from "../waves/use-is-phone";
import { AddRacks, PlannedDialog } from "./add-racks";
import { BinList } from "./bin-list";
import { AttrDialog, ChangeDialog, type ChangeKind } from "./change-dialog";
import { History } from "./history";
import { Denah } from "./denah";
import { SelectionBar } from "./selection-bar";
import { Tiles } from "./tiles";

export type Tab = "denah" | "daftar" | "riwayat";
const TABS: { key: Tab; label: string }[] = [{ key: "denah", label: "Denah" }, { key: "daftar", label: "Daftar bin" }, { key: "riwayat", label: "Riwayat" }];

/**
 * The page body. One selection (bin codes) is shared by the floor plan and the list, so racks picked on
 * the plan stay picked when the list is opened, and the selection bar acts on both.
 * Phones open on Daftar bin: a plan of ~3,000 positions does not fit a phone's width.
 */
export function RacksClient({ bins, aisleOrder, baysPerSide, role, initialTab }: {
  bins: RackBin[]; aisleOrder: string[]; baysPerSide: number; role: Role; initialTab: Tab | null;
}) {
  const phone = useIsPhone();
  const [tab, setTab] = useState<Tab | null>(initialTab);
  const active: Tab = tab ?? (phone ? "daftar" : "denah");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const tiles = useMemo(() => rackTiles(bins), [bins]);
  const plan = useMemo(() => buildFloorPlan(bins, aisleOrder, baysPerSide), [bins, aisleOrder, baysPerSide]);
  const selectedBins = useMemo(() => bins.filter((b) => selected.has(b.bin_code)), [bins, selected]);
  const aisles = useMemo(() => {
    const zones = new Set(bins.filter((b) => b.rack).map((b) => b.zone));
    return [...aisleOrder.filter((z) => zones.has(z)), ...[...zones].filter((z) => !aisleOrder.includes(z)).sort()];
  }, [bins, aisleOrder]);

  // A live refresh can remove bins (a cancelled plan): drop them from the selection.
  useEffect(() => {
    const codes = new Set(bins.map((b) => b.bin_code));
    setSelected((s) => (([...s].every((c) => codes.has(c))) ? s : new Set([...s].filter((c) => codes.has(c)))));
  }, [bins]);

  const toggle = useCallback((codes: string[], on: boolean) => {
    setSelected((s) => {
      const n = new Set(s);
      for (const c of codes) { if (on) n.add(c); else n.delete(c); }
      return n;
    });
  }, []);

  const setAll = useCallback((codes: string[]) => setSelected(new Set(codes)), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const keepLevels = (levels: string[]) => setSelected(new Set(narrowLevels(selectedBins, levels).map((b) => b.bin_code)));

  // The actions the selection bar offers: only those that would change at least one selected bin, by role
  // (the database checks the role again: Tidak ada and lending to CKB 3PL are admin only).
  const admin = role === "admin";
  const kinds = useMemo((): ChangeKind[] => {
    const states = new Set(selectedBins.map(stateOf));
    const racks = selectedBins.filter((b) => b.rack);
    const out: ChangeKind[] = [];
    if (states.has("ACTIVE")) out.push({ field: "STATE", value: "BLOCKED", label: "Blokir", verb: "Blokir" });
    if (states.has("BLOCKED")) out.push({ field: "STATE", value: "ACTIVE", label: "Buka blokir", verb: "Buka blokir" });
    if (admin && (states.has("ACTIVE") || states.has("BLOCKED"))) out.push({ field: "STATE", value: "NOT_PRESENT", label: "Tandai tidak ada", verb: "Tandai tidak ada", danger: true });
    if (admin && states.has("NOT_PRESENT")) out.push({ field: "STATE", value: "PRESENT", label: "Tandai ada lagi", verb: "Tandai ada lagi" });
    if (admin && racks.some((b) => b.owner === "SHELL" && stateOf(b) !== "NOT_PRESENT")) out.push({ field: "OWNER", value: "CKB", label: "Pinjamkan ke CKB 3PL", verb: "Pinjamkan ke CKB 3PL" });
    if (admin && racks.some((b) => b.owner === "CKB")) out.push({ field: "OWNER", value: "SHELL", label: "Kembalikan ke Shell", verb: "Kembalikan ke Shell" });
    return out;
  }, [selectedBins, admin]);
  const codes = useMemo(() => selectedBins.map((b) => b.bin_code), [selectedBins]);
  const planned = useMemo(() => selectedBins.filter((b) => b.block_kind === "PLANNED").map((b) => b.bin_code), [selectedBins]);

  function choose(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <Tiles tiles={tiles} />
      <div className="flex items-end gap-3 border-b border-steel-100">
      <nav className="flex gap-1" aria-label="Bagian halaman">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => choose(t.key)} aria-current={t.key === active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", t.key === active ? "border-ckb font-semibold text-ckb" : "border-transparent text-steel-500 hover:text-steel")}>
            {t.label}
          </button>
        ))}
      </nav>
      {admin && <div className="ml-auto pb-1.5"><AddRacks aisleOrder={aisleOrder} /></div>}
      </div>
      {active === "daftar" && <BinList bins={bins} aisles={aisles} selected={selected} onToggle={toggle} />}
      {active === "denah" && <Denah plan={plan} selected={selected} onToggle={toggle} onSet={setAll} onClear={clear} />}
      {active === "riwayat" && <History />}
      {active !== "riwayat" && (
        <SelectionBar bins={selectedBins} onKeepLevels={keepLevels} onClear={clear}>
          {admin && planned.length > 0 && <PlannedDialog codes={planned} mode="activate" onDone={clear} />}
          {admin && planned.length > 0 && <PlannedDialog codes={planned} mode="cancel" onDone={clear} />}
          {(role === "supervisor" || admin) && kinds.map((k) => <ChangeDialog key={`${k.field}-${k.value}-${k.label}`} codes={codes} kind={k} onDone={clear} />)}
          {(role === "supervisor" || admin) && selectedBins.some((b) => b.rack) && <AttrDialog codes={codes} onDone={clear} />}
        </SelectionBar>
      )}
    </div>
  );
}
