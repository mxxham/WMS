import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { binDistance, distanceLabel, parseBin } from "@/lib/bin-distance";
import { fmtNum } from "@/lib/utils";

export type EmptyBin = { bin_code: string; zone: string; rack: string | null; level: string | null; position: string | null; abc_class: string | null };

const SHOW = 200;

/**
 * Empty rack bins (0043): active, holding nothing and not the target of an
 * open task. With "dekat bin" they are sorted nearest first, for a pallet
 * leftover that has no bin-to-bin move.
 */
export function EmptyTab({ bins, near, aisle, level }: { bins: EmptyBin[]; near: string; aisle: string; level: string }) {
  const from = near ? parseBin(near) : null;
  const aisles = [...new Set(bins.map((b) => b.zone))].sort();
  const levels = [...new Set(bins.map((b) => b.level ?? "").filter(Boolean))].sort();
  const filtered = bins.filter((b) => (!aisle || b.zone === aisle) && (!level || b.level === level));
  const sorted = from
    ? [...filtered].sort((a, b) => binDistance(from, a) - binDistance(from, b) || a.bin_code.localeCompare(b.bin_code))
    : [...filtered].sort((a, b) => a.bin_code.localeCompare(b.bin_code));
  const perAisle = aisles.map((z) => [z, bins.filter((b) => b.zone === z).length] as const);

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <p className="max-w-3xl text-sm text-steel-500">
        Bin rak yang aktif, kosong, dan tidak sedang dituju tugas relokasi. Isi <b>dekat bin</b> dengan bin tempat Anda berdiri
        (mis. palet yang sisanya perlu tempat) untuk melihat bin kosong terdekat dulu.
      </p>
      <form className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4">
        <input type="hidden" name="tab" value="kosong" />
        <div><Label htmlFor="near">Dekat bin</Label><Input id="near" name="near" defaultValue={near} placeholder="mis. CD22E02" className="w-36" autoCapitalize="characters" /></div>
        <div><Label htmlFor="aisle">Lorong</Label>
          <Select id="aisle" name="aisle" defaultValue={aisle} className="w-28"><option value="">Semua</option>{aisles.map((z) => <option key={z}>{z}</option>)}</Select></div>
        <div><Label htmlFor="level">Level</Label>
          <Select id="level" name="level" defaultValue={level} className="w-24"><option value="">Semua</option>{levels.map((l) => <option key={l}>{l}</option>)}</Select></div>
        <Button type="submit">Tampilkan</Button>
        {near && !from && <p className="text-sm text-bad">{near} bukan kode bin rak (contoh CD22E02).</p>}
      </form>

      <div className="flex flex-wrap gap-2">
        <div className="rounded-lg border-l-4 border-ckb bg-white p-3">
          <div className="font-cond text-3xl font-semibold tabular">{fmtNum(bins.length)}</div>
          <div className="text-xs text-steel-500">bin kosong</div>
        </div>
        {perAisle.map(([z, n]) => (
          <Link key={z} href={`/inventory?tab=kosong&aisle=${z}${near ? `&near=${near}` : ""}`}
            className="rounded-lg border-l-4 border-steel-300 bg-white p-3 hover:bg-steel-100">
            <div className="font-cond text-2xl font-semibold tabular">{fmtNum(n)}</div>
            <div className="text-xs text-steel-500">lorong {z}</div>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent>
          {!sorted.length ? <p className="text-sm text-steel-500">Tidak ada bin kosong dengan filter ini.</p> : (
            <Table sticky>
              <thead><tr><Th>Bin</Th><Th>Lorong</Th><Th>Rak</Th><Th>Level</Th><Th>Posisi</Th>{from && <Th>Jarak dari {near.toUpperCase()}</Th>}</tr></thead>
              <tbody>{sorted.slice(0, SHOW).map((b) => (
                <tr key={b.bin_code}>
                  <Td><Link href={`/bin/${b.bin_code}`} className="font-cond text-lg font-semibold underline-offset-2 hover:underline">{b.bin_code}</Link></Td>
                  <Td>{b.zone}</Td><Td>{b.rack}</Td><Td>{b.level}</Td><Td>{b.position}</Td>
                  {from && <Td className="text-xs">{distanceLabel(from, b)}</Td>}
                </tr>
              ))}</tbody>
            </Table>
          )}
          {sorted.length > SHOW && <p className="mt-2 text-xs text-steel-500">{fmtNum(SHOW)} dari {fmtNum(sorted.length)} ditampilkan. Persempit dengan lorong / level.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
