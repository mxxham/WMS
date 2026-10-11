"use client";
import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The white action menu of the Wave page redesign: a bottom sheet on a phone, a centered panel on a
 * desktop (the existing dialog). Its rows are the existing self-contained action buttons; their own
 * confirmation dialogs open stacked on top of it, so every dialog is reused unchanged.
 */
export function ActionMenu({ title, trigger, children, open, onOpenChange }: {
  title: string; trigger?: React.ReactNode; children: React.ReactNode;
  /** controlled, e.g. a whole line card as the trigger on a phone */
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="ghost" size="sm" className="h-11 gap-1 px-3 text-steel-700 hover:bg-steel-100">
              <MoreHorizontal className="h-5 w-5" />Lainnya
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent title={title} className="bg-white text-steel sm:w-[24rem]">
        <div className="space-y-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/** Rows: every button inside becomes a full-width, 44 px, left-aligned row. */
export function MenuSection({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1",
      "[&_button]:h-11 [&_button]:w-full [&_button]:justify-start [&_button]:gap-3 [&_button]:rounded-md",
      "[&_button]:border-0 [&_button]:bg-white [&_button]:px-3 [&_button]:text-left [&_button]:text-sm [&_button]:font-medium",
      "[&_button]:text-steel [&_button]:no-underline [&_button]:shadow-none",
      "[&_button:hover]:bg-steel-100 [&_button:disabled]:opacity-50")}>{children}</div>
  );
}

/** Destructive rows, last, after a divider, in red. */
export function MenuDanger({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 border-t border-steel-100 pt-2 [&_button]:!text-bad"><MenuSection>{children}</MenuSection></div>;
}

/** A quiet one-line note inside a menu (why an action is missing, what a row does). */
export function MenuNote({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 text-xs text-steel-500">{children}</p>;
}
