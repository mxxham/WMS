// Custom 404 for the whole app: an unknown URL lands here, outside any page, so the card has to
// stand on its own. It renders inside the root layout (Tailwind is available), but not always
// inside the (app) shell — a nested `notFound()` call keeps the nav, a mistyped address does not —
// so it avoids anything only the shell provides.
//
// Deliberately obnoxious (user-requested: "as loud as it can"): a turning rainbow wheel, hazard tape,
// siren wash, searchlights, scanlines, two tickers, falling cartons and confetti, a forklift doing laps,
// orbiting bin plates, a glitching jelly 404, a waving heading and a pulsing button. All keyframes live
// in not-found.css (`nf-` prefix). It is still a server component with zero JS.
//
// Under `prefers-reduced-motion` globals.css stops every animation and not-found.css hides every
// `nf-decor` layer, so the page rests as a plain readable card with the Dashboard link.
import Link from "next/link";
import {
  IconAlertTriangle,
  IconBolt,
  IconBox,
  IconForklift,
  IconHome,
  IconMapPinOff,
  IconPackage,
  IconSpeakerphone,
} from "@tabler/icons-react";
import { BRAND } from "@/config/brand";
import "./not-found.css";

/** Deterministic pseudo-random so the server render is stable. */
function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const CONFETTI_COLOURS = ["#C0392B", "#D9941A", "#F4D03F", "#27AE60", "#2A6F97", "#8E44AD", "#FFFFFF", "#E91E63"];

const CONFETTI = Array.from({ length: 60 }, (_, i) => ({
  left: `${(rand(i + 1) * 100).toFixed(2)}%`,
  delay: `${(-rand(i + 101) * 6).toFixed(2)}s`,
  duration: `${(3 + rand(i + 201) * 4).toFixed(2)}s`,
  colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
  round: i % 3 === 0,
}));

const CARTONS = Array.from({ length: 14 }, (_, i) => ({
  left: `${(rand(i + 301) * 95).toFixed(2)}%`,
  delay: `${(-rand(i + 401) * 8).toFixed(2)}s`,
  duration: `${(4 + rand(i + 501) * 5).toFixed(2)}s`,
  size: 22 + Math.round(rand(i + 601) * 30),
  Icon: i % 2 === 0 ? IconBox : IconPackage,
}));

/** Real bin formats, so the joke still reads as ours. */
const PLATES = ["CB01C01", "CC01C01", "STAGING", "CE33A01", "CF40E20", "???????"];

const TICKER = "404 ✦ HALAMAN TIDAK DITEMUKAN ✦ ALAMAT TIDAK DIKENAL ✦ PALET HILANG ✦ BUKA PALET ✦ ";

const HEADING = "Halaman tidak ditemukan";

function Ticker({ reverse, className }: { reverse?: boolean; className: string }) {
  return (
    <div aria-hidden className={`nf-decor relative z-20 overflow-hidden border-y-4 border-black py-1.5 ${className}`}>
      <div className={`nf-ticker ${reverse ? "nf-ticker-r" : "nf-ticker-l"}`}>
        {[0, 1].map((half) => (
          <span key={half} className="pr-2 font-cond text-sm font-black uppercase tracking-[0.2em] sm:text-base">
            {TICKER.repeat(4)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function NotFound() {
  return (
    <main className="nf-root relative isolate flex min-h-[100dvh] flex-col overflow-hidden">
      {/* ---------- background layers ---------- */}
      <div aria-hidden className="nf-decor pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="nf-wheel" />
        <div className="nf-tape absolute inset-0 opacity-25 mix-blend-overlay" />
        <div className="nf-beam nf-beam-a" />
        <div className="nf-beam nf-beam-b" />
        <div className="nf-siren absolute inset-0" />
      </div>

      {/* Falling cartons and confetti. */}
      <div aria-hidden className="nf-decor pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {CARTONS.map(({ left, delay, duration, size, Icon }, i) => (
          <Icon
            key={`c${i}`}
            size={size}
            stroke={1.75}
            className="nf-fall text-[#F4D03F] drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]"
            style={{ left, animationDelay: delay, animationDuration: duration }}
          />
        ))}
        {CONFETTI.map(({ left, delay, duration, colour, round }, i) => (
          <span
            key={`f${i}`}
            className={`nf-confetti ${round ? "rounded-full !h-2.5" : ""}`}
            style={{ left, background: colour, animationDelay: delay, animationDuration: duration }}
          />
        ))}
      </div>

      <Ticker className="bg-[#F4D03F] text-black" />

      {/* ---------- the card ---------- */}
      <div className="relative z-10 grid flex-1 place-items-center px-4 py-12 sm:py-16">
        <div className="relative w-full max-w-sm sm:max-w-md">
          {/* Bin plates orbiting the card. */}
          <div aria-hidden className="nf-decor nf-orbit pointer-events-none absolute left-1/2 top-1/2 -ml-[min(48vw,400px)] -mt-[min(48vw,400px)] h-[min(96vw,800px)] w-[min(96vw,800px)]">
            {PLATES.map((code, i) => (
              <span
                key={code}
                className="absolute left-1/2 top-1/2"
                style={{ transform: `rotate(${(i * 360) / PLATES.length}deg) translateY(calc(-1 * min(48vw, 400px)))` }}
              >
                <span className="nf-orbit-rev block">
                  <span
                    className="block whitespace-nowrap rounded-plate border-2 border-black bg-[#F4D03F] px-2 py-0.5 font-mono text-[11px] font-black tracking-wide text-black shadow-[3px_3px_0_#000]"
                    style={{ transform: `translate(-50%, -50%) rotate(${(-i * 360) / PLATES.length}deg)` }}
                  >
                    {code}
                  </span>
                </span>
              </span>
            ))}
          </div>

          {/* WADUH starburst. */}
          <div aria-hidden className="nf-decor nf-burst absolute -right-4 -top-8 z-30 grid h-24 w-24 place-items-center bg-bad text-center font-cond text-sm font-black uppercase leading-none text-white sm:-right-10 sm:h-28 sm:w-28 sm:text-base">
            Waduh!
            <br />
            Nyasar!
          </div>

          <div className="nf-card relative">
            {/* Rainbow border, hue-cycling. */}
            <div className="nf-border rounded-3xl p-[6px] shadow-[0_0_60px_10px_rgba(244,208,63,0.6)]">
              <div className="relative overflow-hidden rounded-[20px] bg-white">
                <div aria-hidden className="nf-decor nf-tape h-3" />

                <div className="relative px-6 py-8 text-center sm:px-8 sm:py-10">
                  {/* Corner warning lights. */}
                  <IconAlertTriangle aria-hidden size={30} className="nf-decor nf-blink absolute left-3 top-3 text-bad" />
                  <IconAlertTriangle aria-hidden size={30} className="nf-decor nf-blink absolute right-3 top-3 text-warn [animation-delay:-0.5s]" />
                  <IconBolt aria-hidden size={26} className="nf-decor nf-float absolute bottom-4 left-4 text-[#F4D03F] drop-shadow-[0_2px_0_#000]" />
                  <IconSpeakerphone aria-hidden size={28} className="nf-decor nf-float absolute bottom-4 right-4 text-bad [animation-delay:-1.5s]" />

                  {/* The glitching jelly 404. */}
                  <p aria-hidden className="relative inline-block font-cond text-8xl font-black leading-none tracking-tight sm:text-9xl">
                    <span className="nf-404">404</span>
                    <span className="nf-decor nf-glitch nf-glitch-a">404</span>
                    <span className="nf-decor nf-glitch nf-glitch-b">404</span>
                  </p>

                  {/* The lost pin, bouncing inside spinning rings. */}
                  <div className="relative mx-auto mt-6 grid h-20 w-20 place-items-center">
                    <span aria-hidden className="nf-decor nf-ripple absolute inset-0 rounded-full bg-bad/40" />
                    <span aria-hidden className="nf-decor nf-ring absolute -inset-2 rounded-full border-4 border-dashed border-warn" />
                    <span aria-hidden className="nf-decor nf-ring-2 absolute -inset-4 rounded-full border-2 border-dotted border-ckb" />
                    <span className="nf-pin grid h-14 w-14 place-items-center rounded-xl bg-bad text-white shadow-[4px_4px_0_#000]">
                      <IconMapPinOff size={30} stroke={2} aria-hidden />
                    </span>
                  </div>

                  <p className="nf-blink mt-6 text-xs font-black uppercase tracking-[0.3em] text-bad">Alamat tidak dikenal</p>
                  <h1 className="mt-2 font-cond text-3xl font-black tracking-tight text-steel sm:text-4xl" aria-label={HEADING}>
                    {HEADING.split(" ").map((word, w, words) => {
                      // Letter index across the whole heading, so the wave runs on through the spaces.
                      const start = words.slice(0, w).join(" ").length + (w > 0 ? 1 : 0);
                      return (
                        <span key={w} aria-hidden className="inline-block whitespace-nowrap">
                          {word.split("").map((ch, j) => (
                            <span
                              key={j}
                              className="nf-letter"
                              style={{
                                animationDelay: `${-(start + j) * 0.06}s, ${-(start + j) * 0.12}s`,
                                color: CONFETTI_COLOURS[(start + j) % 6],
                              }}
                            >
                              {ch}
                            </span>
                          ))}
                          {w < words.length - 1 && <span className="inline-block w-[0.3em]" />}
                        </span>
                      );
                    })}
                  </h1>
                  <p className="mx-auto mt-3 max-w-[34ch] text-sm font-medium leading-relaxed text-steel-700">
                    Alamat ini tidak ada di peta gudang — mungkin salah ketik, tautan basi, atau halamannya sudah pindah shift.
                  </p>

                  <Link
                    href="/dashboard"
                    className="nf-button mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border-4 border-black bg-bad px-6 font-cond text-base font-black uppercase tracking-wider text-white sm:w-auto"
                  >
                    <IconHome size={20} stroke={2.5} aria-hidden className="nf-decor nf-spin-fast" />
                    <IconHome size={20} stroke={2.5} aria-hidden className="hidden motion-reduce:inline" />
                    Ke Dashboard!!!
                  </Link>

                  <p className="mt-5 text-[11px] font-semibold leading-relaxed text-steel-500">
                    Masih tersesat? Panggil admin — mereka yang memegang peta gudang.
                  </p>
                </div>

                <div aria-hidden className="nf-decor nf-tape h-3 [animation-direction:reverse]" />
              </div>
            </div>
          </div>

          <p className="mt-6 text-center font-cond text-xs font-bold uppercase tracking-[0.2em] text-white drop-shadow-[0_2px_0_#000]">
            {BRAND.appName} <span aria-hidden>·</span> {BRAND.site}
          </p>
        </div>
      </div>

      {/* A forklift doing laps along the bottom, carting a pallet. */}
      <div aria-hidden className="nf-decor pointer-events-none relative z-20 h-16">
        <div className="nf-forklift absolute bottom-1 left-0 flex items-end">
          <div className="nf-forklift-body flex items-end">
            <IconForklift size={56} stroke={1.75} className="text-[#F4D03F] drop-shadow-[0_3px_0_#000]" />
            <IconPackage size={28} stroke={2} className="-ml-1 mb-1 text-white drop-shadow-[0_2px_0_#000]" />
          </div>
        </div>
      </div>

      <Ticker reverse className="bg-bad text-white" />

      {/* Scanlines over everything. */}
      <div aria-hidden className="nf-decor nf-scan pointer-events-none absolute inset-0 z-40" />
    </main>
  );
}
