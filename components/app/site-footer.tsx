"use client";
import Link from "next/link";
import { ABOUT } from "./about-copy";
import { openWelcome } from "./use-welcome-once";

const LINK = "inline-flex min-h-11 items-center px-1 underline-offset-2 hover:text-steel hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb";

/** Every page's footer: owner, credit, the internal-use notice, and Kredit / Lisensi / Privasi. */
export function SiteFooter() {
  return (
    <footer className="site-footer mt-8 border-t border-steel-100 px-4 py-4 text-xs text-steel-500 lg:px-8">
      <p className="flex flex-wrap items-center gap-x-2">
        <span>{ABOUT.copyright}</span>
        <span aria-hidden>·</span>
        <span>{ABOUT.name}</span>
        <span aria-hidden>·</span>
        <span>{ABOUT.credit}</span>
      </p>
      <p>{ABOUT.internal}</p>
      <nav aria-label="Informasi" className="-mx-1 flex flex-wrap gap-x-3">
        <button type="button" onClick={openWelcome} className={LINK}>Kredit</button>
        <Link href="/lisensi" className={LINK}>{ABOUT.licensesTitle}</Link>
        <Link href="/privasi" className={LINK}>{ABOUT.privacyTitle}</Link>
      </nav>
    </footer>
  );
}
