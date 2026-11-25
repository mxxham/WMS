import { Input, Label } from "@/components/ui/input";
import { REQUIRED_FIELDS, SAP_FIELDS, SAP_FIELD_LABEL, type SapField, type SapMapping } from "@/lib/ckb/sap-import";

/** Comma or line separated list, trimmed, empty entries dropped. */
export const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/**
 * The SAP column titles of one mapping: one input per field and the "verified" box. Used for the global mapping (Pengaturan) and for a
 * customer's own mapping (Customer, 0161): same fields, same validation, a different prefix for the form names.
 */
export function MappingFields({ prefix, columns, verified }: { prefix: string; columns: SapMapping; verified: boolean }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {SAP_FIELDS.map((f) => (
          <div key={f}>
            <Label htmlFor={`${prefix}-${f}`}>{SAP_FIELD_LABEL[f]}{REQUIRED_FIELDS.includes(f) ? " *" : ""}</Label>
            <Input id={`${prefix}-${f}`} name={`${prefix}-${f}`} defaultValue={(columns[f] ?? []).join(", ")} placeholder="judul kolom, pisahkan koma" />
          </div>
        ))}
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name={`${prefix}-verified`} defaultChecked={verified} className="h-4 w-4" />
        Terverifikasi dengan file SAP CKB asli</label>
    </>
  );
}

/** The mapping typed into MappingFields; throws (Indonesian) when a required column is not mapped. */
export function readMapping(fd: FormData, prefix: string): { verified: boolean; columns: SapMapping } {
  const columns: Partial<Record<SapField, string[]>> = {};
  for (const f of SAP_FIELDS) { const v = splitList(String(fd.get(`${prefix}-${f}`) ?? "").toLowerCase()); if (v.length) columns[f] = v; }
  for (const f of REQUIRED_FIELDS) if (!columns[f]) throw new Error(`Kolom wajib ${SAP_FIELD_LABEL[f]} belum dipetakan.`);
  return { verified: fd.get(`${prefix}-verified`) === "on", columns };
}
