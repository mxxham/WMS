"use client";
import { useEffect, type ComponentProps, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TODAY_PANEL_ATTR } from "./floor";

/**
 * Home's one button ("Buka dashboard" / "Buka Scan"), the end of the floor line. A plain click plays the
 * same "go" as signing in: the line drives off to the right and the button folds into it (`floor-exit`
 * on the lobby, globals.css). Then, to the Dashboard, the navigation runs inside a view transition: the
 * browser keeps Home's picture until the Dashboard's "Hari ini" panel is on screen (its loading skeleton
 * has one, so this is almost immediate; max 2 s), then
 * grows Home's board of four counts into that panel while the rest cross-fades (TODAY_BOARD).
 *
 * Ctrl/Cmd/Shift/Alt or middle clicks, reduced motion: an ordinary link. Browsers without view
 * transitions: the line still leaves, then a plain navigation. The sidebar's links never animate.
 */
export function FloorDoorLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  useEffect(() => { router.prefetch(href); }, [href, router]);

  function go() {
    const html = document.documentElement;
    if (href !== "/dashboard" || !("startViewTransition" in document)) { router.push(href); return; }
    // The panel's own entrance (fade up) would fight the morph: off while the transition runs.
    html.classList.add("today-handoff");
    const vt = document.startViewTransition(() => new Promise<void>((resolve) => {
      router.push(href);
      const started = Date.now();
      const poll = () => {
        const panel = document.querySelector(`[${TODAY_PANEL_ATTR}]`);
        if ((panel && panel.getClientRects().length > 0) || Date.now() - started > 2000) resolve();
        else setTimeout(poll, 40);
      };
      poll();
    }));
    // Landed: keep the entrance off on the element before dropping the class, or it would start again.
    vt.finished.finally(() => {
      document.querySelectorAll<HTMLElement>(`[${TODAY_PANEL_ATTR}]`).forEach((el) => { el.style.animation = "none"; });
      html.classList.remove("today-handoff");
    });
  }

  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    e.currentTarget.closest("[data-floor-stage]")?.classList.add("floor-exit");
    // Start once the line is mostly off screen (the exit runs 450 ms); Home's board is still in place.
    setTimeout(go, 300);
  }

  return <Link href={href} onClick={handle} data-door-near="" {...props} />;
}
