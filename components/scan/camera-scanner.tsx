"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Phone camera scanner (html5-qrcode). Reads QR, Code 128 and carton EAN / UPC.
 * Loaded dynamically because the library touches `window` on import.
 */
export function CameraScanner({ onResult }: { onResult: (text: string) => void }) {
  const regionId = "qr-region";
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let stopped = false;
    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      if (stopped) return;
      scanner = new Html5Qrcode(regionId, {
        // Bin labels (QR / Code 128) and carton barcodes (EAN / UPC).
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A],
        verbose: false,
      });
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text) => {
            if (done.current) return; // ignore repeated frames of the same code
            done.current = true;
            onResult(text);
          },
          () => {},
        );
      } catch {
        setError("Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau gunakan scanner USB/ketik manual.");
      }
    })();
    return () => {
      stopped = true;
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
  }, [onResult]);

  return (
    <div>
      <div id={regionId} className="overflow-hidden rounded-lg bg-steel" />
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
