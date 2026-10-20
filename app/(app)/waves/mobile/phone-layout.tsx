"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NO_FILTER, waveHref, type RowFilter, type WaveModel } from "../wave-model";
import { DayScreen } from "./day-screen";
import { WaveScreen } from "./wave-screen";

// What this tab pushed, so an on-screen back returns with history.back() (the same entry the
// browser's back would return to) and falls back to replacing the address after a reload or a
// shared link, where the previous entry is not the day.
let pushedWave: string | null = null;
let pushedPick = false;
let dayScroll: number | null = null;

/**
 * The Wave page on a phone (spec §2): screen 1 is the day, screen 2 one wave. The wave and the
 * picking screen live in the address (?wave=, &pick=1), so the browser's back closes them.
 */
export function WavesPhone({ model: m, openWave, picking }: { model: WaveModel; openWave: string | null; picking: boolean }) {
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);
  const [problems, setProblems] = useState(false);
  const wave = openWave ? m.waves.find((w) => w.id === openWave) ?? null : null;

  function openWaveScreen(id: string) {
    dayScroll = window.scrollY;
    pushedWave = id;
    window.history.pushState(null, "", waveHref(m.date, id));
    window.scrollTo(0, 0);
  }
  function backToDay() {
    if (pushedWave && pushedWave === openWave) window.history.back();
    else window.history.replaceState(null, "", waveHref(m.date));
    pushedWave = null;
  }
  function startPicking() {
    if (!wave) return;
    pushedPick = true;
    window.history.pushState(null, "", waveHref(m.date, wave.id, true));
  }
  function closePicking() {
    if (!wave) return;
    if (pushedPick) window.history.back();
    else window.history.replaceState(null, "", waveHref(m.date, wave.id));
    pushedPick = false;
  }
  function restoreDayScroll() {
    if (dayScroll === null) return;
    const y = dayScroll;
    dayScroll = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  return (
    <>
      {wave
        ? <WaveScreen model={m} wave={wave} filter={filter} onClearFilter={() => setFilter(NO_FILTER)} onBack={backToDay}
            picking={picking} onStartPicking={startPicking} onClosePicking={closePicking} onShowProblems={() => setProblems(true)} />
        : <DayScreen model={m} filter={filter} onFilter={setFilter} onOpenWave={openWaveScreen} onShowProblems={() => setProblems(true)}
            onMount={restoreDayScroll} />}
      {problems && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-paper" role="dialog" aria-modal="true" aria-label="Perlu ditangani">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-steel-100 bg-white px-4 py-2">
            <h2 className="font-cond text-xl font-semibold">Perlu ditangani</h2>
            <Button variant="ghost" className="h-11" onClick={() => setProblems(false)}><X className="h-5 w-5" />Tutup</Button>
          </div>
          <div className="space-y-4 p-4 pb-24">{m.panels("phone")}</div>
        </div>
      )}
    </>
  );
}
