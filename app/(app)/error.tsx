"use client";

// Route-level error boundary for the whole (app) group: one query failing on a
// server component must not take the page — and the operator's shift — down.
// Next calls this with the rendered shell already gone, so the card is
// self-contained. Indonesian copy, English code (project convention).
//
// The screen is read top to bottom in one pass, which is why it is ordered this
// way: brand hairline → mark → eyebrow → title → what happened → what did NOT
// happen (the stock is intact) → the digest as a quiet detail to relay → one
// primary and one secondary action. Reassurance sits above the buttons on
// purpose: an operator on a phone should learn that nothing was lost before
// deciding what to tap, and "Coba lagi" is the only filled control on the page.
import { useEffect } from "react";
import Link from "next/link";
import { IconAlertTriangle, IconCircleCheck, IconHome, IconRefresh } from "@tabler/icons-react";

/** The same white panel every page uses (loading.tsx CARD, dashboard PANEL). */
const CARD = "overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(3,39,65,0.05)] ring-1 ring-steel-100";
/** Thumb-sized on a phone (h-11), the pair side by side from `sm` up. */
const ACTION = "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("app/(app) error boundary:", error);
  }, [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center px-4 py-10 lg:px-8">
      <div role="alert" className={`${CARD} animate-fade-in w-full max-w-sm sm:max-w-md`}>
        {/* The brand's water ramp as a cap: navy → ckb → tint, the same order the palette runs. */}
        <div aria-hidden className="h-1 bg-gradient-to-r from-jeir-navy via-ckb to-ckb-tint" />

        <div className="relative px-6 py-8 text-center sm:px-8 sm:py-10">
          {/* A pale sea wash under the mark, so the card has depth without a second colour. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(42,111,151,0.10),transparent_78%)]"
          />

          <div className="relative">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-bad/[0.08] text-bad ring-1 ring-bad/15">
              <IconAlertTriangle size={26} stroke={1.75} aria-hidden />
            </span>

            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-steel-500">Halaman gagal dimuat</p>
            <h1 className="mt-1 text-balance font-cond text-2xl font-semibold tracking-tight text-steel">Terjadi kesalahan</h1>
            <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-steel-500">
              Halaman ini tidak sempat tampil. Bisa karena koneksi terputus saat memuat data.
            </p>

            {/* The reassurance that matters on the floor: nothing was written. */}
            <div className="mt-5 flex items-start gap-2.5 rounded-lg bg-paper px-3 py-2.5 text-left ring-1 ring-steel-100">
              <IconCircleCheck size={18} stroke={1.75} aria-hidden className="mt-px shrink-0 text-ok" />
              <p className="text-xs leading-relaxed text-steel-700">
                <span className="font-semibold text-steel">Stok tidak berubah.</span> Semua catatan gudang — stok, mutasi, dan tugas —
                tetap seperti terakhir tersimpan.
              </p>
            </div>

            {error.digest ? (
              <div className="mt-3 space-y-1">
                <p className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-steel-500">
                  <span>Kode</span>
                  <span className="tabular select-all rounded-plate bg-white px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-steel-700 ring-1 ring-steel-300/60">
                    {error.digest}
                  </span>
                </p>
                <p className="text-[11px] text-steel-500">Sebutkan kode ini bila melapor ke admin.</p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" onClick={reset} className={`${ACTION} bg-ckb text-white hover:bg-ckb-dark active:bg-ckb-dark`}>
                <IconRefresh size={16} stroke={2} aria-hidden /> Coba lagi
              </button>
              <Link href="/dashboard" className={`${ACTION} bg-white text-steel ring-1 ring-steel-300 hover:bg-steel-100 active:bg-steel-100`}>
                <IconHome size={16} stroke={2} aria-hidden /> Ke Dashboard
              </Link>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-steel-500">
              Masih gagal setelah beberapa kali? Tutup lalu buka kembali aplikasinya.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
