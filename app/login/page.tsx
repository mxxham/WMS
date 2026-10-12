import Link from "next/link";
import { BRAND } from "@/config/brand";
import { ABOUT } from "@/components/app/about-copy";
import { LoginForm } from "./login-form";
import { loginRequired } from "@/lib/auth-route";

/** Sign in (spec §1). Outside the app layout: no nav, no footer, no welcome screen. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; nonaktif?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-ckb p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white p-1 ring-1 ring-steel-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" width={40} height={40} className="h-10 w-10" />
          </span>
          <div>
            <h1 className="font-cond text-2xl font-bold leading-tight">{ABOUT.name}</h1>
            <span className="inline-block rounded-plate bg-plate px-1.5 font-cond text-xs font-bold text-steel">{BRAND.site}</span>
          </div>
        </div>
        <p className="text-sm text-steel-500">Masuk dengan akun yang dibuat admin gudang.</p>
        {!loginRequired() && <p className="rounded-md bg-ckb-tint/60 p-2 text-sm">Login belum diwajibkan: tanpa masuk, situs memakai akun bersama. <Link href="/" className="font-semibold underline">Kembali ke aplikasi</Link></p>}
        {sp.nonaktif && <p role="alert" className="text-sm text-bad">Akun ini dinonaktifkan. Hubungi admin.</p>}
        <LoginForm next={sp.next ?? ""} />
        <p className="text-xs text-steel-500">{ABOUT.copyright} · {ABOUT.internal}</p>
      </div>
    </main>
  );
}
