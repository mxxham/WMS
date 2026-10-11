import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "./globals.css";

// "only light": browser and OS auto-dark features (Android "darken web pages", Chrome auto dark mode,
// Firefox/Zen website dark mode) leave the app alone; darkreader-lock does the same for Dark Reader engines.
export const metadata: Metadata = {
  title: "K-one · CKB WSM SUB 2",
  description: "K-one: label bin, scan, alokasi FEFO, dan stok gudang CKB WSM SUB 2",
  other: { "darkreader-lock": "lock" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#135F45", colorScheme: "only light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
