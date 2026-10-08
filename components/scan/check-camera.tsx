"use client";
import { useEffect, useRef } from "react";

const REGION = "check-qr-region";
const COOLDOWN_MS = 2000;

/**
 * Continuous carton scanner for the check screen. A code counts only after
 * the previous one has left the frame (a frame with no code re-arms it) and
 * at least COOLDOWN_MS have passed, so one carton is never read twice.
 */
export function CheckCameraScanner({ onResult }: { onResult: (text: string) => void }) {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let stopped = false;
    let armed = true;
    let lastText = "";
    let lastAt = 0;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (stopped) return;
      scanner = new Html5Qrcode(REGION, { verbose: false });
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text) => {
            const now = Date.now();
            if (!armed) return;
            if (text === lastText && now - lastAt < COOLDOWN_MS) return;
            armed = false;
            lastText = text;
            lastAt = now;
            onResultRef.current(text);
          },
          () => { if (!armed) armed = true; },
        );
      } catch { /* the parent shows a fallback message */ }
    })();
    return () => {
      stopped = true;
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
  }, []);

  return <div id={REGION} className="overflow-hidden rounded-lg bg-steel" />;
}
