"use client";

// Route-level error boundary for the whole (app) group: one query failing on a
// server component must not take the page — and the operator's shift — down.
// Next calls this with the rendered shell already gone, so the card is
// self-contained. Indonesian copy, English code (project convention).
import { useEffect } from "react";
import Link from "next/link";
import { IconRefresh, IconHome } from "@tabler/icons-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("app/(app) error boundary:", error);
  }, [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-[0_1px_2px_rgba(3,39,65,0.05)] ring-1 ring-steel-100">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-bad/10">
          <span aria-hidden className="text-lg font-bold text-bad">!</span>
        </div>
        <h1 className="font-cond text-lg font-semibold text-steel">Terjadi kesalahan</h1>
        <p className="mt-1 text-sm text-steel-500">
          Halaman tidak bisa dimuat. Data gudang tidak berubah karena kesalahan ini — coba muat ulang.
        </p>
        {error.digest ? <p className="mt-2 text-xs text-steel-300">Kode: {error.digest}</p> : null}
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md bg-ckb px-3.5 py-2 text-sm font-medium text-white hover:bg-ckb-dark"
          >
            <IconRefresh size={16} aria-hidden /> Coba lagi
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md bg-paper px-3.5 py-2 text-sm font-medium text-steel ring-1 ring-steel-100 hover:bg-steel-100"
          >
            <IconHome size={16} aria-hidden /> Ke Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
