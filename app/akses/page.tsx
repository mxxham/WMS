import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { resolveAppsHome } from "@/lib/apps";
import { Button } from "@/components/ui/button";

/** Access-denied page for accounts with no app access. Top-level, outside (app) and /ckb. */
export default async function AksesPage() {
  const user = await getSessionUser();
  // Not signed in → sign in (middleware sends this already; defensive for direct opens).
  if (!user) redirect("/login");
  // Authorized after all (access was granted since sign-in): land on the app home, never a false denial.
  if (user.apps.length > 0) redirect(resolveAppsHome(user.apps, user.defaultApp));
  return (
    <main className="flex min-h-screen items-center justify-center bg-jeir-navy bg-jeir-side p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-white p-6 text-center">
        <h1 className="font-cond text-2xl font-bold text-bad">Tidak ada akses aplikasi</h1>
        <p className="text-sm text-steel-500">Akun Anda belum diberi akses ke aplikasi manapun. Hubungi admin gudang.</p>
        <form action="/keluar" method="post">
          <Button type="submit" variant="outline" className="w-full">Keluar</Button>
        </form>
        <p className="text-xs text-steel-500">Setelah admin memberi akses, muat ulang halaman ini.</p>
      </div>
    </main>
  );
}
