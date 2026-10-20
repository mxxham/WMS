"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SHOW_WELCOME } from "@/config/warehouse";
import { WELCOME_KEY, shouldShowWelcome } from "@/lib/welcome";

const OPEN_EVENT = "welcome:open";

/** The Kredit link: reopens the welcome without touching the once-per-browser flag. */
export function openWelcome() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * Whether the welcome is open. It opens by itself once per browser, on the first normal page
 * (checked again on every page change, so a visit that starts on a floor screen waits), and on
 * demand from openWelcome(). Closing an automatic opening records the flag.
 */
export function useWelcomeOnce(): { open: boolean; close: () => void; restoreFocus: () => void } {
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<"auto" | "manual" | null>(null);
  // Where focus was when it opened (a scan field, the Kredit link): it goes back there on close.
  // Captured before opening, because the dialog moves focus to its own button as it mounts.
  const returnTo = useRef<HTMLElement | null>(null);
  const remember = () => { returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };

  useEffect(() => {
    if (open) return;
    let seen: boolean | null;
    try { seen = localStorage.getItem(WELCOME_KEY) === "1"; } catch { seen = null; }
    const search = params.toString();
    if (shouldShowWelcome({ enabled: SHOW_WELCOME, seen, path, search: search ? `?${search}` : "" })) { remember(); setOpen("auto"); }
  }, [path, params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onOpen = () => { remember(); setOpen((o) => o ?? "manual"); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  function close() {
    if (open === "auto") {
      try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* storage unavailable: it was never shown then */ }
    }
    setOpen(null);
  }
  function restoreFocus() {
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) el.focus();
  }
  return { open: open !== null, close, restoreFocus };
}
