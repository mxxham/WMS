"use client";
import * as D from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { ABOUT } from "./about-copy";
import { useWelcomeOnce } from "./use-welcome-once";
import { BRAND } from "@/config/brand";

/** The words on the welcome screen (shared with the Home page: about-copy.ts). */
const TEXT = { name: ABOUT.name, welcome: ABOUT.welcome, credit: ABOUT.credit, about: ABOUT.about, button: ABOUT.welcomeButton };

/**
 * A one-time full-screen welcome with the credits (lib/welcome.ts decides when). A Radix dialog:
 * focus stays inside while open (only its own button is focused, nothing behind it, so a scanner
 * never types into the page), Esc or Lanjut closes it, and focus returns to where it was.
 *
 * The warehouse is the screen: the same photo as the sign-in page, edge to edge, so the first thing
 * anyone sees is the floor they are about to work on — the forklift and the checker on either side of
 * one glass plate. The plate carries its own navy, so no word ever sits on bare photo.
 */
export function WelcomeScreen() {
  const { open, close, restoreFocus } = useWelcomeOnce();
  return (
    <D.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <D.Portal>
        {/* No trigger button, so Radix would drop focus on <body>: put it back where it was. */}
        <D.Content aria-modal="true" onCloseAutoFocus={(e) => { e.preventDefault(); restoreFocus(); }}
          className="welcome-fade fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-jeir-navy text-white focus:outline-none">

          {/* The floor, edge to edge. On a phone the crop narrows to the forklift crew instead of the
              empty mast in the middle of the frame. Fixed, so a short screen scrolls the plate, not the photo. */}
          <div aria-hidden="true" className="login-photo pointer-events-none fixed inset-0 bg-[url('/ckb-warehouse.webp')] bg-cover bg-[position:20%_44%] sm:bg-center" />
          {/* One light sweep across it as the screen arrives (off with reduced motion). */}
          <div aria-hidden="true" className="home-shine pointer-events-none fixed inset-0 overflow-hidden" />

          {/* Scrim, three passes: a flat navy wash so the floor reads as our navy, a vertical gradient that
              deepens both edges, then a vignette so the eye lands in the middle where the plate sits. */}
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-jeir-navy/25" />
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-gradient-to-t from-jeir-navy via-jeir-navy/35 to-jeir-navy/70" />
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_125%_95%_at_50%_48%,transparent_24%,rgba(3,39,65,0.78)_100%)]" />
          {/* The app's dot-grid echo, top right, so the navy reads as this product's navy. */}
          <div aria-hidden="true" className="home-dots pointer-events-none fixed inset-0 opacity-70" />
          {/* The screen's top edge, a thin water line. */}
          <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-jeir-teal/50 to-transparent" />

          {/* On a phone the plate docks to the bottom (thumb on Lanjut, the crew still above it). From sm
              up it sits centred. min-h-full keeps every row reachable on a short, landscape screen. */}
          <div className="relative flex min-h-full flex-col items-center justify-end px-5 pb-6 pt-16 sm:justify-center sm:px-6 sm:py-10">
            <div className="w-full max-w-sm sm:max-w-[25rem]">
              <div className="login-rise relative overflow-hidden rounded-2xl bg-jeir-navy/55 p-6 text-center shadow-[0_28px_80px_-24px_rgba(2,15,25,0.95)] ring-1 ring-white/15 backdrop-blur-md sm:p-7"
                style={{ "--d": "90ms" } as React.CSSProperties}>
                {/* A sheen at the plate's top edge: it is glass over a photo, not a flat panel. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.07] to-transparent" />

                {/* Identity: the sign-in page's teal rule and mark, on the glass. */}
                <div className="login-rise flex flex-col items-center" style={{ "--d": "220ms" } as React.CSSProperties}>
                  <div className="h-0.5 w-12 bg-jeir-teal" aria-hidden="true" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={BRAND.logo} alt="" width={64} height={64} className="mt-5 block h-16 w-16 rounded-xl ring-1 ring-white/10" />
                </div>

                <div className="login-rise mt-4 space-y-2" style={{ "--d": "300ms" } as React.CSSProperties}>
                  <D.Title className="font-cond text-[2.1rem] font-bold leading-[1.05] tracking-tight sm:text-[2.6rem]">{TEXT.name}</D.Title>
                  <D.Description className="text-[15px] leading-relaxed text-white/80 sm:text-base">{TEXT.welcome}</D.Description>
                </div>

                <div className="login-rise mt-6 space-y-2.5" style={{ "--d": "380ms" } as React.CSSProperties}>
                  <div className="h-px w-full bg-white/10" aria-hidden="true" />
                  <p className="inline-block rounded-plate bg-jeir-navy/35 px-2.5 py-1 font-cond text-lg font-bold text-jeir-teal ring-1 ring-inset ring-jeir-teal/25">{TEXT.credit}</p>
                  <p className="text-[13px] leading-relaxed text-white/75 sm:text-sm">{TEXT.about}</p>
                </div>

                <div className="login-rise mt-6" style={{ "--d": "460ms" } as React.CSSProperties}>
                  <Button variant="accent" className="h-12 w-full rounded-xl text-base shadow-lg shadow-jeir-navy/50" onClick={close}>{TEXT.button}</Button>
                </div>
              </div>
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
