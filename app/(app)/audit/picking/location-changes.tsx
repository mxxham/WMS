import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";
import {
  ACTION_LABEL, changeAction, jakartaTime, locationText, sortChanges, type LocationChange,
} from "@/lib/location-changes";
import { DownloadLocationChanges } from "./download-location-changes";

const MAX_DAYS = 92;
const isDate = (s: string | undefined): s is string => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

/** ?from=&to= (default: the header's day), at most MAX_DAYS apart, from <= to. */
export function changeRange(date: string, from?: string, to?: string): { from: string; to: string } {
  let f = isDate(from) ? from : date;
  let t = isDate(to) ? to : isDate(from) ? from : date;
  if (f > t) [f, t] = [t, f];
  const limit = new Date(Date.parse(`${f}T00:00:00Z`) + (MAX_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from: f, to: t > limit ? limit : t };
}

/**
 * Perubahan lokasi (0130): every pick whose location changed after planning, original bin next to
 * the new one, for a range of days or one wave. The same rows go to Excel.
 */
export async function LocationChangesView({ from, to, wave }: { from: string; to: string; wave: string | null }) {
  const supabase = await createClient();
  let rows: LocationChange[] = [];
  let error: string | null = null;
  try {
    rows = await fetchAll<LocationChange>((a, b) => {
      let q = supabase.from("pick_location_change_list").select("*").gte("planned_date", from).lte("planned_date", to);
      if (wave) q = q.eq("wave_no", wave);
      return q.order("id").range(a, b);
    });
  } catch (e) { error = (e as Error).message; }
  const sorted = sortChanges(rows);
  const fefo = rows.filter((r) => r.fefo_skipped).length;
  const tasks = new Set(rows.map((r) => r.task_id)).size;
  const actual = rows.filter((r) => r.kind === "ACTUAL").length;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-3">
        <input type="hidden" name="tab" value="lokasi" />
        <input type="hidden" name="date" value={from} />
        <div><Label htmlFor="lc-from">Dari</Label><Input id="lc-from" type="date" name="from" defaultValue={from} className="w-auto" /></div>
        <div><Label htmlFor="lc-to">Sampai</Label><Input id="lc-to" type="date" name="to" defaultValue={to} className="w-auto" /></div>
        <div><Label htmlFor="lc-wave">Wave NO</Label><Input id="lc-wave" name="wave" defaultValue={wave ?? ""} placeholder="semua" className="w-28" /></div>
        <Button type="submit" variant="outline">Tampilkan</Button>
        <div className="ml-auto"><DownloadLocationChanges rows={rows} from={from} to={to} wave={wave} /></div>
      </form>

      {error && <p role="alert" className="text-sm text-bad">Daftar tidak bisa dibaca: {error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Perubahan lokasi", value: rows.length },
          { label: "Baris pick berubah", value: tasks },
          { label: "Dipick dari bin lain", value: actual },
          { label: "FEFO dilewati", value: fefo, bad: fefo > 0 },
        ].map((t) => (
          <div key={t.label} className="rounded-lg bg-white p-3">
            <div className={cn("font-cond text-3xl font-semibold tabular", t.bad && "text-bad")}>{fmtNum(t.value)}</div>
            <div className="text-xs text-steel-500">{t.label}</div>
          </div>
        ))}
      </div>

      <p className="text-sm text-steel-500">
        Setiap kali lokasi pick berubah setelah direncanakan: lewat Ubah baris, Pindah sisa, ikut palet, Isi dari picklist,
        atau karena barang diambil dari bin lain. Lokasi awal = bin saat rencana dibuat.
      </p>

      {!error && sorted.length === 0 && <p className="text-sm text-steel-500">Tidak ada perubahan lokasi di rentang ini.</p>}

      {sorted.length > 0 && (
        <>
          {/* Desktop: one table */}
          <Card className="hidden md:block">
            <CardContent>
              <Table sticky>
                <thead><tr>
                  <Th>Tanggal · NO</Th><Th>Shipment</Th><Th>SKU</Th><Th className="text-right">Qty</Th>
                  <Th>Lokasi awal</Th><Th>Sebelum</Th><Th>Sesudah</Th><Th>Aksi</Th><Th>Oleh · waktu</Th><Th>Alasan</Th>
                </tr></thead>
                <tbody>{sorted.map((c) => (
                  <tr key={c.id} className={cn(c.fefo_skipped && "bg-bad/5")}>
                    <Td className="whitespace-nowrap">{c.planned_date}<br /><span className="text-xs text-steel-500">NO {c.wave_no}</span></Td>
                    <Td className="text-xs">{c.task_type === "PICK" ? c.shipment_number ?? "–" : "Bin To Bin"}</Td>
                    <Td><span className="font-semibold">{c.sku}</span><span className="block max-w-56 truncate text-xs text-steel-500">{c.description}</span></Td>
                    <Td className="text-right tabular">{fmtNum(Number(c.quantity))}</Td>
                    <Td className="font-mono text-xs">{c.original_bin ?? "–"}</Td>
                    <Td className="font-mono text-xs">{locationText(c.old_bin, c.old_batch, c.old_expiry)}{toBin(c.old_to_bin)}</Td>
                    <Td className="font-mono text-xs">{locationText(c.new_bin, c.new_batch, c.new_expiry)}{toBin(c.new_to_bin)}
                      {c.fefo_skipped && <span className="block font-sans font-semibold text-bad">FEFO dilewati</span>}</Td>
                    <Td className="text-xs">{ACTION_LABEL[changeAction(c)]}{c.source === "LOG" && <span className="block text-steel-500">dari Riwayat</span>}</Td>
                    <Td className="whitespace-nowrap text-xs">{c.changed_by_name ?? "–"}<br /><span className="text-steel-500">{jakartaTime(c.changed_at)}</span></Td>
                    <Td className="max-w-72 text-xs text-steel-500">{c.reason ?? "–"}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </CardContent>
          </Card>

          {/* Phone: one card per change */}
          <div className="space-y-2 md:hidden">
            {sorted.map((c) => (
              <div key={c.id} className={cn("rounded-lg bg-white p-3 text-sm", c.fefo_skipped && "ring-1 ring-bad")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{c.sku}</span>
                  <span className="text-xs text-steel-500">{c.planned_date} · NO {c.wave_no}</span>
                </div>
                <div className="truncate text-xs text-steel-500">{c.description}</div>
                <div className="mt-2 font-mono text-xs">
                  <div><span className="font-sans text-steel-500">Sebelum </span>{locationText(c.old_bin, c.old_batch, c.old_expiry)}{toBin(c.old_to_bin)}</div>
                  <div><span className="font-sans text-steel-500">Sesudah </span>{locationText(c.new_bin, c.new_batch, c.new_expiry)}{toBin(c.new_to_bin)}</div>
                </div>
                {c.fefo_skipped && <div className="mt-1 text-xs font-semibold text-bad">FEFO dilewati</div>}
                <div className="mt-2 text-xs text-steel-500">
                  {fmtNum(Number(c.quantity))} · {ACTION_LABEL[changeAction(c)]} · {c.changed_by_name ?? "–"} · {jakartaTime(c.changed_at)}
                  {c.reason && <div>{c.reason}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function toBin(bin: string | null) {
  return bin ? <span className="block text-steel-500">→ tujuan {bin}</span> : null;
}
