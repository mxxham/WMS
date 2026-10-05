import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { binDistance, distanceLabel, parseBin } from "@/lib/bin-distance";
import { cn, fmtNum } from "@/lib/utils";

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
  // Tiles count inside the other filter: aisle tiles for the chosen level, level tiles for the chosen aisle.
  const perAisle = aisles.map((z) => [z, bins.filter((b) => b.zone === z && (!level || b.level === level)).length] as const);
  const perLevel = levels.map((l) => [l, bins.filter((b) => b.level === l && (!aisle || b.zone === aisle)).length] as const);
  const href = (p: { aisle?: string; level?: string }) => {
    const q = new URLSearchParams({ tab: "kosong" });
    const a = p.aisle ?? aisle, l = p.level ?? level;
    if (a) q.set("aisle", a);
    if (l) q.set("level", l);
    if (near) q.set("near", near);
    return `/inventory?${q.toString()}`;
  };

  const tile = (active: boolean) => cn(
    "min-w-[4.5rem] rounded-md px-3 py-2 text-left ring-1 transition-colors",
    active ? "bg-ckb-tint ring-ckb text-ckb-dark" : "bg-white ring-steel-100 hover:bg-steel-100",
  );

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="max-w-3xl text-sm text-steel-500">
          Bin rak yang aktif, kosong, dan tidak sedang dituju tugas relokasi. Isi <b>dekat bin</b> dengan bin tempat Anda berdiri
          (mis. palet yang sisanya perlu tempat) untuk melihat bin kosong terdekat dulu.
        </p>
        <span className="text-sm text-steel-500"><b className="font-cond text-lg text-steel tabular">{fmtNum(filtered.length)}</b> bin cocok</span>
      </div>

      <Card>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="kosong" />
            <div><Label htmlFor="near">Dekat bin</Label><Input id="near" name="near" defaultValue={near} placeholder="mis. CD22E02" className="w-36" autoCapitalize="characters" /></div>
            <div><Label htmlFor="aisle">Lorong</Label>
              <Select id="aisle" name="aisle" defaultValue={aisle} className="w-28"><option value="">Semua</option>{aisles.map((z) => <option key={z}>{z}</option>)}</Select></div>
            <div><Label htmlFor="level">Level</Label>
              <Select id="level" name="level" defaultValue={level} className="w-24"><option value="">Semua</option>{levels.map((l) => <option key={l}>{l}</option>)}</Select></div>
            <Button type="submit">Tampilkan</Button>
            {near && !from && <p role="alert" className="text-sm text-bad">{near} bukan kode bin rak (contoh CD22E02).</p>}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-steel-500">Level{aisle && ` · lorong ${aisle}`}</p>
        <div className="flex flex-wrap gap-2">
          <Link href={href({ level: "" })} className={tile(!level)}>
            <div className="font-cond text-2xl font-semibold tabular">{fmtNum(bins.filter((b) => !aisle || b.zone === aisle).length)}</div>
            <div className="text-xs opacity-70">semua level</div>
          </Link>
          {perLevel.map(([l, n]) => (
            <Link key={l} href={href({ level: l === level ? "" : l })} className={tile(l === level)}>
              <div className="font-cond text-2xl font-semibold tabular">{fmtNum(n)}</div>
              <div className="text-xs opacity-70">level {l}{l === "A" ? " (pickface)" : ""}</div>
            </Link>
          ))}
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-steel-500">Lorong{level && ` · level ${level}`}</p>
        <div className="flex flex-wrap gap-2">
          <Link href={href({ aisle: "" })} className={tile(!aisle)}>
            <div className="font-cond text-2xl font-semibold tabular">{fmtNum(bins.filter((b) => !level || b.level === level).length)}</div>
            <div className="text-xs opacity-70">semua lorong</div>
          </Link>
          {perAisle.map(([z, n]) => (
            <Link key={z} href={href({ aisle: z === aisle ? "" : z })} className={tile(z === aisle)}>
              <div className="font-cond text-2xl font-semibold tabular">{fmtNum(n)}</div>
              <div className="text-xs opacity-70">lorong {z}</div>
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardContent>
          {!sorted.length ? (
            <div className="py-8 text-center">
              <p className="font-cond text-lg font-semibold text-steel-700">Tidak ada bin kosong</p>
              <p className="text-sm text-steel-500">Tidak ada yang cocok dengan filter lorong / level saat ini. Coba &quot;Semua&quot;.</p>
            </div>
          ) : (
            <Table sticky>
              <thead><tr><Th>Bin</Th><Th>Lorong</Th><Th>Rak</Th><Th>Level</Th><Th>Posisi</Th>{from && <Th>Jarak dari {near.toUpperCase()}</Th>}</tr></thead>
              <tbody>{sorted.slice(0, SHOW).map((b) => (
                <tr key={b.bin_code} className="hover:bg-steel-100/50">
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
