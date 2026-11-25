"use client";
import { useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type LightboxItem = { id: string; caption: string };

/**
 * A photo at full size over the page. Left and right arrows (or the buttons) walk through the set, Escape closes.
 * The file comes from the gated route, never from storage directly.
 */
export function Lightbox({ items, index, onIndex, onClose }: { items: LightboxItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const go = useCallback((d: number) => onIndex((index + d + items.length) % items.length), [index, items.length, onIndex]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [go, onClose]);
  const cur = items[index];
  if (!cur) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Foto housekeeping" className="fixed inset-0 z-[60] flex flex-col bg-black/90 p-3 text-white" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 pb-2" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 truncate text-sm">{cur.caption} <span className="text-white/60">· {index + 1}/{items.length}</span></p>
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" aria-label="Tutup foto" onClick={onClose}><X className="h-5 w-5" /></Button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/ckb/housekeeping/photo/${cur.id}`} alt={cur.caption} className="max-h-full max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
        {items.length > 1 && (
          <>
            <Button variant="ghost" size="icon" className="absolute left-0 h-12 w-12 text-white hover:bg-white/10 hover:text-white" aria-label="Foto sebelumnya" onClick={(e) => { e.stopPropagation(); go(-1); }}><ChevronLeft className="h-7 w-7" /></Button>
            <Button variant="ghost" size="icon" className="absolute right-0 h-12 w-12 text-white hover:bg-white/10 hover:text-white" aria-label="Foto berikutnya" onClick={(e) => { e.stopPropagation(); go(1); }}><ChevronRight className="h-7 w-7" /></Button>
          </>
        )}
      </div>
    </div>
  );
}
