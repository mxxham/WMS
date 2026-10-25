import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "./globals.css";
import { BRAND } from "@/config/brand";

// "only light": browser and OS auto-dark features (Android "darken web pages", Chrome auto dark mode,
// Firefox/Zen website dark mode) leave the app alone; darkreader-lock does the same for Dark Reader engines.
export const metadata: Metadata = {
  title: `${BRAND.appName} · ${BRAND.site}`,
  description: `${BRAND.appName}: label bin, scan, alokasi FEFO, dan stok gudang ${BRAND.site}`,
  other: { "darkreader-lock": "lock" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#032741", colorScheme: "only light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        {/* Both SDKs are self-injecting client components: an effect appends a <script> to <head> and
            queues pageviews/vitals on window.va / window.si until it loads. They are not broken when no
            tag is visible — on Vercel the build sets NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG, so
            the injected src is a per-deployment hashed path (e.g. /20217b6609385b5c/script.js), never
            the legacy /_vercel/<name>/script.js alias, and the served runtime no-ops when
            navigator.webdriver is set. Verify collection by the beacons (POST .../view, POST .../vitals),
            not by a script[src*="_vercel"] selector, and not from a CDP-driven browser. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
