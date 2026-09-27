"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description }: { className?: string; children: React.ReactNode; title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-steel/50" />
      <D.Content className={cn("fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-xl bg-white p-5 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl", className)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="font-cond text-xl font-semibold">{title}</D.Title>
            {description ? <D.Description className="text-sm text-steel-500">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close aria-label="Tutup" className="rounded p-1 hover:bg-steel-100"><X className="h-5 w-5" /></D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
