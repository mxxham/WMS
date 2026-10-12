import { PageHeader } from "@/components/app/page-header";
import { ABOUT } from "@/components/app/about-copy";
import data from "@/lib/third-party-notices.json";

// Only the package list reaches the page; the licence texts are files in public/licenses/.

type Notice = { name: string; version: string; license: string; author: string | null; text: string | null };
const notices = data as unknown as { packages: Notice[] };

/** Lisensi: the app's own terms, then every open-source package it ships with its licence text (scripts/notices.mjs). */
export default function LicensesPage() {
  const counts = new Map<string, number>();
  for (const p of notices.packages) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);
  return (
    <main>
      <PageHeader title={ABOUT.licensesTitle} />
      <div className="max-w-4xl space-y-6 p-4 lg:p-8">
        <section className="space-y-2">
          <p className="font-medium">{ABOUT.copyright}. Hak cipta dilindungi.</p>
          <p className="text-sm text-steel-700">{ABOUT.licensesIntro}</p>
        </section>
        <section aria-labelledby="lic-summary" className="space-y-2">
          <h2 id="lic-summary" className="font-cond text-xl font-semibold">{notices.packages.length} pustaka</h2>
          <p className="text-sm text-steel-700">
            {[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l === "UNKNOWN" ? "tidak dicantumkan" : l} (${n})`).join(" · ")}
          </p>
        </section>
        <section aria-labelledby="lic-list" className="space-y-2">
          <h2 id="lic-list" className="font-cond text-xl font-semibold">Daftar dan teks lisensi</h2>
          <p className="text-sm text-steel-700">Tekan nama lisensi untuk membuka teks lengkapnya.</p>
          <ul className="divide-y divide-steel-100 rounded-lg bg-white">
            {notices.packages.map((p) => (
              <li key={`${p.name}@${p.version}`}>
                <div className="flex min-h-11 flex-wrap items-center gap-x-2 px-4 py-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-steel-500 tabular">{p.version}</span>
                  {p.author && <span className="text-xs text-steel-500">{p.author}</span>}
                  <span className="ml-auto text-steel-700">
                    {p.text
                      // Each licence text is its own small file, opened only when wanted (keeps this page light).
                      ? <a href={`/licenses/${p.text}.txt`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb">{p.license === "UNKNOWN" ? "teks lisensi" : p.license}</a>
                      : <span title="Paket ini tidak menyertakan berkas lisensi">{p.license === "UNKNOWN" ? "tidak dicantumkan" : p.license} (tanpa berkas)</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
