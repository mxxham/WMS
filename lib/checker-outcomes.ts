/**
 * Checker scan outcomes: one place for the Indonesian label, colour tone,
 * icon, sound and vibration of each result. Colour is never the only signal —
 * every outcome also carries a label, an icon, a tone and a haptic pattern.
 */

export const CHECK_OUTCOMES = ["ACCEPTED", "UNKNOWN_BARCODE", "WRONG_ITEM", "OVER_SCAN"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export type OutcomeTone = "ok" | "warn" | "bad";
export type OutcomeIcon = "check" | "question" | "wrong" | "over";

export type OutcomeMeta = {
  label: string;
  tone: OutcomeTone;
  icon: OutcomeIcon;
  /** WebAudio beeps, in order. */
  beeps: { freq: number; ms: number }[];
  /** navigator.vibrate pattern (ms). */
  vibrate: number[];
};

export const CHECK_OUTCOME_META: Record<CheckOutcome, OutcomeMeta> = {
  ACCEPTED:        { label: "Diterima",           tone: "ok",   icon: "check",    beeps: [{ freq: 880, ms: 130 }],                  vibrate: [60] },
  UNKNOWN_BARCODE: { label: "Barcode tak dikenal", tone: "warn", icon: "question", beeps: [{ freq: 440, ms: 220 }],                  vibrate: [40, 60, 40] },
  WRONG_ITEM:      { label: "Barang salah",        tone: "bad",  icon: "wrong",    beeps: [{ freq: 300, ms: 140 }, { freq: 300, ms: 140 }], vibrate: [140, 60, 140] },
  OVER_SCAN:       { label: "Berlebih",            tone: "warn", icon: "over",     beeps: [{ freq: 520, ms: 110 }, { freq: 520, ms: 110 }], vibrate: [80, 50, 80] },
};

export const OUTCOME_TONE_CLASS: Record<OutcomeTone, string> = {
  ok: "bg-ok text-white",
  warn: "bg-warn text-white",
  bad: "bg-bad text-white",
};

let audio: AudioContext | null = null;

/** Call from the first user gesture (the Start check tap) so a later beep is allowed. */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio = audio ?? new Ctor();
    void audio.resume();
  } catch { /* no audio: the label, colour and icon still say the outcome */ }
}

export function playOutcome(outcome: CheckOutcome): void {
  if (typeof window === "undefined") return;
  const meta = CHECK_OUTCOME_META[outcome];
  try {
    if (audio) {
      let at = audio.currentTime;
      for (const beep of meta.beeps) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "square";
        osc.frequency.value = beep.freq;
        gain.gain.value = 0.06;
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(at);
        osc.stop(at + beep.ms / 1000);
        at += beep.ms / 1000 + 0.03;
      }
    }
  } catch { /* ignore */ }
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(meta.vibrate);
  } catch { /* ignore */ }
}
