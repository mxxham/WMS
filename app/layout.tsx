import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "./globals.css";

export const metadata: Metadata = { title: "K-one · CKB WSM SUB 2", description: "K-one: label bin, scan, alokasi FEFO, dan stok gudang CKB WSM SUB 2" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#135F45" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
