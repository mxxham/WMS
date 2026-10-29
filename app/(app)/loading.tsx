import {
  ChartCardSkeleton, ListCardSkeleton, PageSkeleton, PairSkeleton, StatBandSkeleton, TableCardSkeleton, TilesSkeleton,
} from "@/components/loading/skeleton";

/**
 * Route-group skeleton — what the floor sees the instant a nav link is tapped, while the server
 * renders the next page. It fills the main column only: the sidebar, the phone bottom bar and the
 * footer come from (app)/layout.tsx and never blink, so the shell stays whole and only the content
 * is missing.
 *
 * Two page shapes share this group, so the skeleton carries both:
 *   • the dashboard's navy "hari ini" band, with its gauges and four stat tiles,
 *   • every other page's PageHeader + stack of white `rounded-xl ring-steel-100` cards.
 * Blocks sit at the height the real blocks land on, so the swap-in does not jump. Nothing is
 * written: a placeholder that prints a number would be lying, and every number is a measurement
 * of the stock.
 *
 * The pieces themselves live in components/loading/skeleton.tsx — one `Bone`, one card, one pulse
 * rule for every route in the app. Read the a11y and motion contract there; this file is the
 * arrangement of the dashboard's column, which is the shape most pages start from.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat halaman">
      <StatBandSkeleton desktopOnly />
      <TilesSkeleton />
      <div className="grid gap-5 lg:grid-cols-5">
        <ChartCardSkeleton />
        <ListCardSkeleton />
      </div>
      <TableCardSkeleton />
      <PairSkeleton />
    </PageSkeleton>
  );
}
