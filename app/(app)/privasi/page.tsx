import { PageHeader } from "@/components/app/page-header";
import { ABOUT } from "@/components/app/about-copy";

/** Privasi: what the system records about workers and why (UU PDP No. 27/2022: tell people). */
export default function PrivacyPage() {
  return (
    <main>
      <PageHeader title={ABOUT.privacyTitle} />
      <div className="max-w-2xl space-y-6 p-4 lg:p-8">
        {ABOUT.privacy.map((s) => (
          <section key={s.h} className="space-y-2">
            <h2 className="font-cond text-xl font-semibold">{s.h}</h2>
            {s.p.map((t) => <p key={t} className="leading-relaxed text-steel-700">{t}</p>)}
          </section>
        ))}
        <section className="space-y-1">
          <h2 className="font-cond text-xl font-semibold">Kontak</h2>
          <p className="text-steel-700">{ABOUT.privacyContact}</p>
        </section>
        <p className="text-sm text-steel-500">{ABOUT.copyright} · {ABOUT.internal}</p>
      </div>
    </main>
  );
}
