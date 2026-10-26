import Link from "next/link";
import { BRAND } from "@/config/brand";
import { ABOUT } from "@/components/app/about-copy";
import { LoginForm } from "./login-form";
import { loginRequired } from "@/lib/auth-route";

/**
 * Sign in (spec §1). Outside the app layout: no nav, no footer, no welcome screen.
 * Split 70/30: left — the warehouse, photo first, one quiet brand block; right — the working form
 * on the app's own paper background, so sign-in flows into the app without a change of scene.
 */
export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ next?: string; nonaktif?: string }> }) {
  const sp = await searchParams;

  // Real figures from the deployment (seed: bins & SKUs), not marketing copy.
  const facts = ["2.970 bin", "106 SKU", "FEFO ketat"];

  return (
    <main className="flex min-h-screen">
      {/* LEFT · 70% — the photo is the hero; words sit on a scrim at the bottom-left and nowhere else. */}
      <aside className="relative hidden lg:block lg:w-[70%] overflow-hidden bg-jeir-navy">
        <div className="login-photo absolute inset-0 bg-[url('/ckb-warehouse.webp')] bg-cover bg-center" aria-hidden="true" />
        {/* Bottom-heavy scrim, only where the brand block reads. */}
        <div className="absolute inset-0 bg-gradient-to-t from-jeir-navy/95 via-jeir-navy/35 to-jeir-navy/10" aria-hidden="true" />

        {/* Brand block */}
        <div className="absolute inset-x-0 bottom-0 p-8 lg:p-14">
          <div className="login-rise max-w-lg" style={{ "--d": "250ms" } as React.CSSProperties}>
            <div className="mb-6 h-0.5 w-14 bg-jeir-teal" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" width={56} height={56} className="h-14 w-14" />
            <h1 className="mt-5 font-cond text-5xl font-bold leading-none tracking-tight text-white">
              {ABOUT.name}
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-white/70">
              Sistem manajemen gudang minyak pelumas Shell —{" "}
              <span className="text-white">akurasi stok, kecepatan pick, keamanan audit.</span>
            </p>
            {/* Site plate: the same device as the sidebar, where this sign-in leads. */}
            <span className="mt-6 inline-block rounded-plate bg-plate px-2 py-1 font-cond text-xs font-bold text-jeir-navy">
              {BRAND.site}
            </span>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Kapasitas sistem">
              {facts.map((f) => (
                <li key={f} className="tabular rounded-plate border border-white/25 bg-jeir-navy/60 px-2.5 py-1 text-xs font-medium text-white/80 backdrop-blur-[2px]">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      {/* RIGHT · 30% — the app's own paper: the form is a tool, not a pitch. */}
      <div className="relative flex w-full flex-col bg-paper lg:w-[30%] lg:h-screen">
        <div className="flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:px-12">
          {/* Mobile brand mark (the left panel is hidden here). */}
          <div className="login-rise mb-8 flex items-center gap-3 lg:hidden" style={{ "--d": "80ms" } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" width={44} height={44} className="h-11 w-11 rounded-md" />
            <div>
              <p className="font-cond text-lg font-bold leading-tight text-steel">{ABOUT.name}</p>
              <p className="text-xs text-steel-500">{BRAND.site}</p>
            </div>
          </div>

          <header className="login-rise" style={{ "--d": "60ms" } as React.CSSProperties}>
            <h2 className="font-cond text-3xl font-bold tracking-tight text-steel">Masuk</h2>
            <p className="mt-2 text-sm text-steel-500">Masuk dengan akun yang dibuat admin gudang.</p>
            {!loginRequired() && (
              <p className="mt-1 text-sm text-steel-500">
                Login belum diwajibkan —{" "}
                <Link href="/" className="font-medium text-ckb underline underline-offset-2 hover:text-ckb-dark">
                  pakai akun bersama
                </Link>
              </p>
            )}
          </header>

          {sp.nonaktif && (
            <p role="alert" className="login-rise mt-4 text-sm text-bad" style={{ "--d": "100ms" } as React.CSSProperties}>
              Akun ini dinonaktifkan. Hubungi admin.
            </p>
          )}

          <div className="mt-7">
            <LoginForm next={sp.next ?? ""} />
          </div>
        </div>

        <footer className="px-6 pb-6 sm:px-10 lg:px-12">
          <p className="text-xs text-steel-500">
            {ABOUT.copyright} · {ABOUT.internal}
          </p>
        </footer>
      </div>
    </main>
  );
}