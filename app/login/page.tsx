import Link from "next/link";
import { BRAND } from "@/config/brand";
import { ABOUT } from "@/components/app/about-copy";
import { FloorLine, FloorPhoto } from "@/components/floor/floor";
import { LoginForm } from "./login-form";
import { loginRequired } from "@/lib/auth-route";

/**
 * Sign in, read like the warehouse floor (components/floor): the CKB floor in navy on the left, and one
 * painted yellow line running across it into the form on the right, the way in. Outside the app layout:
 * no nav, no footer, no welcome screen. Below `lg` the photo becomes a band above the form (the floor
 * signs in on a phone) and the line runs along its foot, ending over the form.
 */
export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ next?: string; nonaktif?: string }> }) {
  const sp = await searchParams;

  // Real figures of this warehouse (bins and SKUs in the system), shown as rack plates.
  const facts = ["2.970 bin", "106 SKU", "FEFO per tanggal expired"];

  return (
    <main className="flex min-h-screen flex-col overflow-x-clip bg-jeir-navy lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(26rem,32rem)]">
      {/* THE FLOOR · a band on a phone, the whole left side from lg. */}
      <section aria-labelledby="login-place" data-floor-stage className="relative isolate flex min-h-[15.5rem] shrink-0 flex-col overflow-hidden text-white lg:min-h-screen">
        <FloorPhoto src={BRAND.floorPhoto} position="38% 60%"
          alt="Lantai gudang CKB: forklift membawa palet karton di depan rak tinggi, seorang petugas memberi arahan." />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-jeir-navy via-jeir-navy/55 to-jeir-navy/25" />

        <header className="relative flex items-center gap-3 px-5 pt-5 sm:px-8 lg:px-14 lg:pt-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt="" width={40} height={40} className="h-10 w-10 rounded-md" />
          <div className="leading-tight">
            <p className="font-cond text-xl font-bold">{ABOUT.name}</p>
            <p className="text-sm text-white/70">{BRAND.site}</p>
          </div>
        </header>

        <div className="relative mt-auto px-5 pb-6 pt-8 sm:px-8 lg:px-14 lg:pb-14">
          <h1 id="login-place" className="max-w-[16ch] text-balance font-cond text-3xl font-bold leading-[0.98] tracking-[-0.02em] lg:text-[clamp(2.75rem,1.6rem+3vw,4.75rem)] lg:tracking-[-0.03em]">
            Gudang pelumas Shell<span className="hidden lg:inline">, Surabaya.</span>
          </h1>
          <ul className="mt-4 flex flex-wrap gap-2 lg:mt-8" aria-label="Isi sistem">
            {facts.map((f) => (
              <li key={f} className="rounded-plate bg-white px-2.5 py-1 font-cond text-sm font-bold tabular-nums text-jeir-navy">{f}</li>
            ))}
          </ul>
        </div>
        {/* The line: across the floor, stopping 40 px short of the form, at the height of its Masuk button
            (lg: the line's centre is 96 + 12 px above the floor; the form below ends 84 px up, so the 48 px
            button centres on it). On a phone it runs along the band's foot, above the form. */}
        <div className="relative flex pb-5 pl-5 sm:pl-8 lg:pb-24 lg:pl-14 lg:pr-10">
          <FloorLine />
        </div>
        <p className="absolute bottom-4 left-14 hidden text-xs text-white/55 lg:block">{ABOUT.copyright}. {ABOUT.internal}</p>
      </section>

      {/* THE FORM · the app's own paper, so signing in flows into the app without a change of scene. */}
      <section aria-labelledby="login-title" className="relative flex flex-1 flex-col bg-paper">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:mx-0 lg:max-w-none lg:justify-end lg:px-14 lg:pb-[84px]">
          <h2 id="login-title" className="font-cond text-4xl font-bold tracking-[-0.02em] text-steel">Masuk</h2>
          <p className="mt-2 text-steel-500">Pakai nama pengguna dan kata sandi dari admin gudang.</p>
          {!loginRequired() && (
            <p className="mt-1 text-sm text-steel-500">
              Login belum diwajibkan.{" "}
              <Link href="/" className="font-medium text-ckb underline underline-offset-2 hover:text-ckb-dark">Pakai akun bersama</Link>
            </p>
          )}
          {sp.nonaktif && <p role="alert" className="mt-4 text-sm text-bad">Akun ini dinonaktifkan. Hubungi admin.</p>}
          <div className="mt-8">
            <LoginForm next={sp.next ?? ""} />
          </div>
        </div>
        <footer className="px-6 pb-6 sm:px-10 lg:hidden">
          <p className="text-xs text-steel-500">{ABOUT.copyright}. {ABOUT.internal}</p>
        </footer>
      </section>
    </main>
  );
}
