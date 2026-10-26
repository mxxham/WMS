"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type FilterField =
  | { name: string; label: string; kind: "select"; options: { value: string; label: string }[]; all?: string }
  | { name: string; label: string; kind: "date" }
  | { name: string; label: string; kind: "text"; placeholder?: string };

/** Filters live in the URL (shareable, survives refresh); the server page reads them. */
export function FilterBar({ fields }: { fields: FilterField[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function apply(fd: FormData) {
    const next = new URLSearchParams(params.toString());
    for (const f of fields) {
      const v = String(fd.get(f.name) ?? "").trim();
      if (v) next.set(f.name, v); else next.delete(f.name);
    }
    start(() => router.push(`${path}?${next.toString()}`));
  }

  return (
    <form action={apply} className="grid grid-cols-2 gap-3 rounded-lg border border-steel-100 bg-white p-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end">
      {fields.map((f) => (
        <div key={f.name} className="min-w-0 lg:w-44">
          <Label htmlFor={`f-${f.name}`} className="text-xs">{f.label}</Label>
          {f.kind === "select" ? (
            <Select id={`f-${f.name}`} name={f.name} defaultValue={params.get(f.name) ?? ""}>
              <option value="">{f.all ?? "Semua"}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ) : (
            <Input id={`f-${f.name}`} name={f.name} type={f.kind === "date" ? "date" : "text"} defaultValue={params.get(f.name) ?? ""}
              placeholder={f.kind === "text" ? f.placeholder : undefined} />
          )}
        </div>
      ))}
      <div className="col-span-2 flex gap-2 sm:col-span-3 lg:col-span-1">
        <Button type="submit" disabled={pending}>{pending ? "Memuat…" : "Terapkan"}</Button>
        <Button type="button" variant="ghost" onClick={() => start(() => router.push(path))}>Reset</Button>
      </div>
    </form>
  );
}
