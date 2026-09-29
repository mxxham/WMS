import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `sticky`: the header row stays visible while scrolling. The table then
 * scrolls in its own box (at most the screen height), because a sticky
 * header cannot stick to the page from inside the horizontal-scroll wrapper.
 */
export function Table({ className, sticky, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { sticky?: boolean }) {
  return (
    <div className={cn("w-full overflow-x-auto", sticky && "max-h-[calc(100dvh-5rem)] overflow-y-auto")}>
      <table className={cn("w-full border-collapse text-sm tabular", className,
        // border-collapse drops a sticky cell's border: draw the line with a shadow instead
        sticky && "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-white [&_thead_th]:shadow-[inset_0_-1px_0_#A8B6B0]")} {...props} />
    </div>
  );
}
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("border-b border-steel-300 px-3 py-2 text-left text-xs font-semibold text-steel-500", className)} {...p} />
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("border-b border-steel-100 px-3 py-2 align-top", className)} {...p} />
);
