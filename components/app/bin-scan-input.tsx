"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CameraScanner = dynamic(() => import("@/components/scan/camera-scanner").then((m) => m.CameraScanner), { ssr: false });

/**
 * Bin code field: a USB/Bluetooth scanner types the label's code, the phone
 * camera reads the location label, or the code is typed. Upper-cased.
 */
export function BinScanInput({ id, value, onChange, list, placeholder = "scan label / ketik bin" }: {
  id: string; value: string; onChange: (v: string) => void; list?: string; placeholder?: string;
}) {
  const [camera, setCamera] = useState(false);
  return (
    <div>
      {/* The camera button is thumb-sized and on the right edge, where the right thumb already is. */}
      <div className="flex gap-2">
        <Input id={id} value={value} list={list} placeholder={placeholder} className="h-11 font-cond text-base uppercase"
          onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <Button type="button" variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Scan label bin dengan kamera" onClick={() => setCamera((c) => !c)}><Camera className="h-5 w-5" /></Button>
      </div>
      {camera && <div className="mt-2"><CameraScanner onResult={(t) => { setCamera(false); onChange(t.trim().toUpperCase()); }} /></div>}
    </div>
  );
}
