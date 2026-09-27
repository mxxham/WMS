"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseBinCode } from "@/config/warehouse";

const CameraScanner = dynamic(() => import("@/components/scan/camera-scanner").then((m) => m.CameraScanner), { ssr: false });

export function ScanClient() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // USB/Bluetooth scanners type like a keyboard and end with Enter, so the
  // field must always have focus when the camera is not in use.
  useEffect(() => {
    if (camera) return;
    const refocus = () => input.current?.focus();
    refocus();
    window.addEventListener("focus", refocus);
    return () => window.removeEventListener("focus", refocus);
  }, [camera]);

  const go = useCallback((raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    // Still navigate for unknown formats: the bin page explains what is wrong.
    setHint(parseBinCode(code) ? null : `Format "${code}" bukan kode bin yang dikenal, tetap dicari…`);
    router.push(`/bin/${encodeURIComponent(code)}?scan=1`);
  }, [router]);

  const onCamera = useCallback((text: string) => { setCamera(false); go(text); }, [go]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <form onSubmit={(e) => { e.preventDefault(); go(value); setValue(""); }}>
        <label htmlFor="scan" className="mb-2 block font-cond text-lg font-semibold">Scan atau ketik kode bin</label>
        <input
          id="scan" ref={input} value={value} onChange={(e) => setValue(e.target.value)}
          autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go"
          placeholder="CA01C01"
          className="h-20 w-full rounded-plate border-4 border-steel bg-plate px-4 text-center font-cond text-5xl font-bold uppercase tracking-tight text-steel placeholder:text-steel/30"
        />
      </form>
      <Button size="lg" variant={camera ? "outline" : "default"} className="w-full" onClick={() => setCamera((c) => !c)}>
        {camera ? <><CameraOff className="h-5 w-5" />Tutup kamera</> : <><Camera className="h-5 w-5" />Scan pakai kamera</>}
      </Button>
      {camera && <CameraScanner onResult={onCamera} />}
      {hint && <p className="text-sm text-warn">{hint}</p>}
      <p className="text-sm text-steel-500">Scanner USB/Bluetooth: arahkan ke label, kode langsung terkirim.</p>
    </div>
  );
}
