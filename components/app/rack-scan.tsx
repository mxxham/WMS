"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normBin } from "@/lib/pick-line";
import { cn } from "@/lib/utils";

const CameraScanner = dynamic(() => import("@/components/scan/camera-scanner").then((m) => m.CameraScanner), { ssr: false });

export type ScanMethod = "scan" | "ketik";
/** A bin label read at the rack (0068): the code, and whether it was scanned or typed. */
export type RackConfirm = { code: string; method: ScanMethod };

export function rackMatches(target: string, rack: RackConfirm | null): boolean {
  return !!rack && normBin(rack.code) !== "" && normBin(rack.code) === normBin(target);
}

// A USB/Bluetooth scanner types the whole code within a few milliseconds per character; a person does not.
const SCANNER_MS_PER_CHAR = 35;

/**
 * Rack scan (0068): the picker confirms the bin by its location label. The
 * camera reads the QR, a USB/Bluetooth scanner types into the field, or the
 * code is typed (recorded as typed, "diketik"). Green with the bin when it
 * matches, red naming both bins when it does not.
 */
export function RackScan({ id, target, value, onChange, onTakeFrom, hideButton = false }: {
  id: string; target: string; value: RackConfirm | null; onChange: (v: RackConfirm | null) => void;
  /** Ambil dari <scanned>: offered on a mismatch when the caller can take from the scanned bin instead. */
  onTakeFrom?: (scanned: string) => void;
  /** The scan button is left out (e.g. once the bin is confirmed). */
  hideButton?: boolean;
}) {
  const [camera, setCamera] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const timing = useRef<{ first: number; last: number; pasted: boolean }>({ first: 0, last: 0, pasted: false });

  const bin = normBin(target);
  const code = value ? normBin(value.code) : "";
  const ok = code !== "" && code === bin;

  function submit() {
    const c = normBin(text);
    if (!c) return;
    const t = timing.current;
    const fast = !t.pasted && c.length >= 4 && t.last - t.first <= SCANNER_MS_PER_CHAR * (c.length - 1);
    onChange({ code: c, method: fast ? "scan" : "ketik" });
    setText(""); setTyping(false);
  }

  return (
    <div className="space-y-2">
      {value && code !== "" && (ok
        ? <p role="status" className="rounded-md bg-ok/10 px-3 py-2 font-cond text-lg font-semibold text-ok">
            <Check className="mr-1 inline h-5 w-5" />{bin}{value.method === "ketik" && <span className="ml-2 text-xs font-normal text-steel-500">diketik</span>}
          </p>
        : <div role="alert" className="space-y-2 rounded-md bg-bad/10 p-3">
            <p className="text-sm font-semibold text-bad">Bin salah: kamu scan {code}, baris ini {bin}</p>
            {onTakeFrom && <Button variant="outline" className="h-11 w-full" onClick={() => onTakeFrom(code)}>Ambil dari {code}</Button>}
          </div>)}
      {!hideButton && (
        <>
          {camera && <CameraScanner onResult={(t) => { setCamera(false); onChange({ code: normBin(t), method: "scan" }); }} />}
          <Button className="h-14 w-full text-base" variant={ok ? "outline" : "default"} onClick={() => { setTyping(false); setCamera((c) => !c); }}>
            <Camera className="h-5 w-5" />{camera ? "Tutup kamera" : ok ? "Scan ulang" : "Scan label bin"}
          </Button>
          {typing ? (
            <div className="flex gap-2">
              <Input id={id} autoFocus value={text} placeholder={`kode bin, mis. ${bin || "CB34D02"}`} aria-label="Kode bin"
                className="h-11 font-cond text-base uppercase" autoCapitalize="characters" autoComplete="off"
                onPaste={() => { timing.current.pasted = true; }}
                onChange={(e) => {
                  const now = performance.now();
                  if (!text) timing.current = { first: now, last: now, pasted: timing.current.pasted && e.target.value !== "" };
                  else timing.current.last = now;
                  if (!e.target.value) timing.current = { first: 0, last: 0, pasted: false };
                  setText(e.target.value.toUpperCase());
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
              <Button className="h-11 shrink-0" disabled={!normBin(text)} onClick={submit}>OK</Button>
            </div>
          ) : (
            <button type="button" className={cn("block w-full text-center text-sm text-steel-500 underline")}
              onClick={() => { setCamera(false); setTyping(true); setText(""); timing.current = { first: 0, last: 0, pasted: false }; }}>
              ketik kode
            </button>
          )}
        </>
      )}
    </div>
  );
}
