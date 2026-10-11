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
      <div className="flex gap-1">
        <Input id={id} value={value} list={list} placeholder={placeholder} className="font-cond uppercase"
          onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <Button type="button" size="icon" variant="outline" aria-label="Scan label bin dengan kamera" onClick={() => setCamera((c) => !c)}><Camera className="h-4 w-4" /></Button>
      </div>
      {camera && <div className="mt-2"><CameraScanner onResult={(t) => { setCamera(false); onChange(t.trim().toUpperCase()); }} /></div>}
    </div>
  );
}
