"use client";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { Layout } from "@/lib/warehouse-types";
import Link from "next/link";
import { saveLayoutAction } from "../actions";

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
            {/* 0148: Block C is another building, drawn in its own area of the 3D view. */}
            <p className="pt-2 text-sm font-semibold">Block C (gedung lain)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div><Label htmlFor="block_c_x">FA-01 di X (m)</Label><Input id="block_c_x" name="block_c_x" type="number" step="0.1" defaultValue={layout.block_c?.origin.x ?? 0} /></div>
              <div><Label htmlFor="block_c_z">FA-01 di Z (m)</Label><Input id="block_c_z" name="block_c_z" type="number" step="0.1" defaultValue={layout.block_c?.origin.z ?? 70} /></div>
              <div><Label htmlFor="block_c_pitch">Jarak antar slot (m)</Label><Input id="block_c_pitch" name="block_c_pitch" type="number" step="0.1" min={0.5} defaultValue={layout.block_c?.slot_pitch_m ?? 2.6} /></div>
              <div><Label htmlFor="block_c_depth">Kedalaman satu slot (m)</Label><Input id="block_c_depth" name="block_c_depth" type="number" step="0.1" min={1} defaultValue={layout.block_c?.slot_depth_m ?? 7} /></div>
              <div><Label htmlFor="block_c_gap">Jarak baris FA ke baris FB (m)</Label><Input id="block_c_gap" name="block_c_gap" type="number" step="0.1" min={1} defaultValue={layout.block_c?.lane_gap_m ?? 10} /></div>
              <div><Label htmlFor="block_c_pallet">Tinggi satu palet (m)</Label><Input id="block_c_pallet" name="block_c_pallet" type="number" step="0.1" min={0.2} defaultValue={layout.block_c?.pallet_height_m ?? 1.2} /></div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Status & kelas bin</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {/* 0132: blocking, bins that do not exist, lending racks to CKB 3PL, new racks and ABC per bin have one page. */}
          <p className="text-steel-500">Blokir bin, tandai bin tidak ada, pinjamkan rak ke CKB 3PL, tambah rak baru, dan kelas ABC lokasi
            diatur di Rak &amp; Lokasi, dengan alasan dan riwayat.</p>
          <Link href="/racks" className="inline-block rounded-md bg-ckb px-4 py-2 font-semibold text-white">Buka Rak &amp; Lokasi</Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Kelas ABC SKU</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-steel-500">Kelas ABC dihitung otomatis tiap awal bulan dari baris picking bulan lalu, dengan riwayat per bulan.
            Batas A dan B ada di Aturan inventory di atas.</p>
          <Link href="/abc" className="inline-block rounded-md bg-ckb px-4 py-2 font-semibold text-white">Buka Kelas ABC</Link>
        </CardContent>
      </Card>
    </div>
  );
}
