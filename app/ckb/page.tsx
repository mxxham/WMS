/** CKB 3PL holding screen — white theme; operational modules arrive in a later phase. */
import Link from "next/link";
import { CKB_MODULES } from "./modules";

export default function CkbPage() {
  const streams = ["Freeport", "CGP", "SIP", "MNE", "Boiler", "SSB"] as const;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-cond text-3xl font-bold text-steel">CKB 3PL</h1>

        <p className="mt-2 max-w-2xl text-sm text-steel-500">
          Aplikasi ini sedang disiapkan untuk CKB Warehouse 5 dan akan mendukung enam aliran
          operasional utama:
        </p>

        <ul className="mt-4 flex flex-wrap gap-3 text-sm" role="list">
          {streams.map((s) => (
            <li
              key={s}
              className="rounded-plate border border-steel-100 bg-white px-3 py-1.5 text-steel shadow-sm"
            >
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Planned modules grid */}
      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="font-cond text-xl font-semibold text-steel">
          Modul yang direncanakan
        </h2>
        <div className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {CKB_MODULES.map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="group bg-white border border-steel-100 rounded-xl p-4 hover:border-steel-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-cond text-lg font-semibold text-steel group-hover:text-ckb transition-colors">
                  {module.label}
                </h3>
                <span className="flex-shrink-0 rounded-plate bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">
                  Segera
                </span>
              </div>
              <p className="mt-2 text-sm text-steel-500">{module.blurb}</p>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-steel-500 text-center">
          Semua modul CKB 3PL masih dalam pengembangan.
        </p>
      </section>
    </div>
  );
}
