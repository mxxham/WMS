import { CircleAlert, CircleCheck, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A tile's or panel's state as a small glyph with its word for screen readers (DESIGN.md §5: state is
 * never a coloured accent border, and never colour alone). Put it beside the label it qualifies.
 */
const TONES = {
  bad: { Icon: CircleAlert, cls: "text-bad", word: "Bermasalah" },
  warn: { Icon: TriangleAlert, cls: "text-warn", word: "Perlu dicek" },
  wait: { Icon: Clock, cls: "text-ckb", word: "Menunggu" },
  ok: { Icon: CircleCheck, cls: "text-ok", word: "Beres" },
} as const;
export type StatusTone = keyof typeof TONES;

export function StatusIcon({ tone, word, className }: { tone: StatusTone; word?: string; className?: string }) {
  const t = TONES[tone];
  const label = word ?? t.word;
  return (
    <span title={label} className={cn("inline-flex shrink-0", t.cls, className)}>
      <t.Icon aria-hidden className="h-4 w-4" /><span className="sr-only">{label}</span>
    </span>
  );
}
