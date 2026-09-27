"use client";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { Layout } from "@/lib/warehouse-types";
import { recomputeAbcAction, saveLayoutAction, setBinStatusAction } from "../actions";

export function SettingsForms({ layout }: { layout: Layout & { _note?: string } }) {
  const f = (name: keyof Layout, label: string) => (
    <div><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type="number" step="0.01" defaultValue={String(layout[name])} required /></div>
  );
  return (
    <div className="grid gap-6 p-4 lg:grid-cols-2 lg:p-8">
      <Card className="lg:row-span-2">
        <CardHeader><CardTitle>Layout gudang (tampilan 3D)</CardTitle></CardHeader>
        <CardContent>
          {layout._note && <p className="mb-3 rounded-md bg-warn/15 p-2 text-sm">{layout._note}</p>}
          <ActionForm action={saveLayoutAction} submit="Simpan & hitung ulang koordinat">
            <div><Label htmlFor="aisle_order">Urutan aisle (depan ke belakang)</Label><Input id="aisle_order" name="aisle_order" defaultValue={layout.aisle_order.join(", ")} /></div>
            <div className="grid grid-cols-2 gap-3">
              {f("bay_width_m", "Lebar 1 bay rak (m)")}
              {f("positions_per_bay", "Posisi palet per bay")}
              {f("level_height_m", "Tinggi per level (m)")}
              {f("rack_depth_m", "Kedalaman rak (m)")}
              {f("aisle_width_m", "Lebar lorong (m)")}
              <div>
                <Label htmlFor="bays_per_side">Rak per sisi (0 = satu baris)</Label>
                <Input id="bays_per_side" name="bays_per_side" type="number" min={0} step={1} defaultValue={String(layout.bays_per_side ?? 0)} />
                <p className="mt-1 text-xs text-steel-500">20: rak 01–20 sisi kiri, 21–40 sisi kanan (21 di belakang 01).</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="floor_x">Area lantai X (m)</Label><Input id="floor_x" name="floor_x" type="number" step="0.1" defaultValue={layout.floor_zone_origin.x} /></div>
              <div><Label htmlFor="floor_z">Area lantai Z (m)</Label><Input id="floor_z" name="floor_z" type="number" step="0.1" defaultValue={layout.floor_zone_origin.z} /></div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Status & kelas bin</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={setBinStatusAction} submit="Perbarui bin">
            <div><Label htmlFor="codes">Kode bin</Label><textarea id="codes" name="codes" rows={3} className="w-full rounded-md border border-steel-300 p-2 font-mono text-sm" placeholder="CC19A01 CC19A02" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="status">Status</Label><Select id="status" name="status"><option value="active">Aktif</option><option value="blocked">Diblokir</option></Select></div>
              <div><Label htmlFor="abc">Kelas ABC lokasi</Label><Select id="abc" name="abc"><option value="">Tidak diubah</option><option>A</option><option>B</option><option>C</option><option value="clear">Kosongkan</option></Select></div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Hitung ulang kelas ABC SKU</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={recomputeAbcAction} submit="Hitung ulang">
            <p className="text-sm text-steel-500">A = SKU yang menyumbang 80% baris picking pertama, B = 15% berikutnya, C = sisanya dan SKU tanpa picking.</p>
            <div><Label htmlFor="days">Periode (hari)</Label><Input id="days" name="days" type="number" min={7} defaultValue={90} /></div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
