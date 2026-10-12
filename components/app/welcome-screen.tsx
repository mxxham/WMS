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
 */
export function WelcomeScreen() {
  const { open, close, restoreFocus } = useWelcomeOnce();
  return (
    <D.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <D.Portal>
        {/* No trigger button, so Radix would drop focus on <body>: put it back where it was. */}
        <D.Content aria-modal="true" onCloseAutoFocus={(e) => { e.preventDefault(); restoreFocus(); }}
          className="welcome-fade fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-ckb p-6 text-white focus:outline-none">
          <div className="w-full max-w-sm space-y-6 text-center">
            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND.logo} alt="" width={64} height={64} className="h-16 w-16" />
            </span>
            <div className="space-y-2">
              <D.Title className="font-cond text-4xl font-bold leading-tight">{TEXT.name}</D.Title>
              <D.Description className="text-lg text-white/85">{TEXT.welcome}</D.Description>
            </div>
            <div className="space-y-1">
              <p className="inline-block rounded-plate bg-plate px-2 py-0.5 font-cond text-lg font-bold text-steel">{TEXT.credit}</p>
              <p className="text-sm text-white/75">{TEXT.about}</p>
            </div>
            <Button variant="plate" className="h-12 w-full text-base" onClick={close}>{TEXT.button}</Button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
