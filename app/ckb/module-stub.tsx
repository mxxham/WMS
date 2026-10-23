import { CKB_MODULES, type CkbModule } from "./modules";

/**
 * Honest placeholder card for a CKB 3PL module.
 * Shows the module label, a "Segera" (soon) chip, the blurb, and a muted notice line.
 * No actions, no forms, no fake data — just the truth that this module is under development.
 */
export function ModuleStub({ module }: { module: CkbModule }) {
  return (
    <div className="bg-white border border-steel-100 rounded-xl p-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-cond text-2xl font-bold text-steel">{module.label}</h1>
        <span className="flex-shrink-0 rounded-plate bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
          Segera
        </span>
      </div>
      <p className="mt-3 text-sm text-steel-500">{module.blurb}</p>
      <p className="mt-4 text-xs text-steel-500">
        Modul ini masih dalam pengembangan. Tidak ada tindakan yang tersedia di halaman ini.
      </p>
    </div>
  );
}