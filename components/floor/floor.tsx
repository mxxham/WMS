import { cn } from "@/lib/utils";

/**
 * Home -> Dashboard (floor-door-link.tsx): the Dashboard's "Hari ini" panel carries this attribute, and it
 * and Home's board of four counts share this transition name. Plain strings in a server-safe module:
 * exported from the "use client" file they would reach server components as client references.
 */
export const TODAY_PANEL_ATTR = "data-today-panel";
export const TODAY_BOARD = "today-board";

/**
 * The Login and Home screens read like the warehouse floor: the building in navy, and one painted
 * yellow line (the lane markings on the CKB floor) leading each person to their next step. The line is
 * the screens' only animation: it comes in from the left on load, and on signing in it carries on out to
 * the right, so Home's line, coming in from the left, reads as the same arrow arriving. Static with
 * reduced motion.
 *
 * It stretches to fill its row (`flex-1`), so whatever it points at (a button, the form) sits exactly
 * at its arrow, at every width, without measuring anything.
 */
export function FloorLine({ className }: { className?: string }) {
  return (
    // The box clips; its right padding leaves room for the arrow's nudge. On a successful sign-in the
    // page adds `floor-exit` and the same line drives on to the right, out of the screen (globals.css).
    <span aria-hidden className={cn("floor-box relative flex min-w-10 flex-1 overflow-hidden pr-2", className)}>
      <span className="floor-run flex w-full items-center">
        <span className="block h-1.5 flex-1 rounded-l-full bg-floor" />
        {/* The painted arrowhead: a chevron as wide as two line widths, like the floor stencils. */}
        <svg viewBox="0 0 16 24" className="floor-nudge -ml-px h-6 w-4 shrink-0 text-floor" fill="currentColor">
          <path d="M0 9h4L0 0h6l10 12L6 24H0l4-9H0z" />
        </svg>
      </span>
    </span>
  );
}

/**
 * The CKB warehouse photo in navy: greyscale under a navy multiply, so its own colours (yellow forklift,
 * floor paint) drop out and the drawn line is the only colour on screen. A plain <img> with a high fetch
 * priority, because it is the largest thing painted (LCP).
 */
export function FloorPhoto({ src, alt, className, position = "50% 50%" }: {
  src: string; alt: string; className?: string; position?: string;
}) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-jeir-navy", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={1200} height={771} fetchPriority="high" decoding="async"
        className="floor-photo h-full w-full object-cover" style={{ objectPosition: position }} />
      <div aria-hidden className="absolute inset-0 bg-jeir-navy mix-blend-multiply" style={{ opacity: 0.58 }} />
    </div>
  );
}
