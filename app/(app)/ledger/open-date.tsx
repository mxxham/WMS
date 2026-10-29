"use client";
import { useRouter } from "next/navigation";
import { Input, Label } from "@/components/ui/input";

/** Date picker that opens a day of Buku stok. */
export function OpenDate({ max }: { max: string }) {
  const router = useRouter();
  return (
    <div>
      <Label htmlFor="ledger-date">Buka tanggal</Label>
      <Input id="ledger-date" type="date" max={max} onChange={(e) => e.target.value && router.push(`/ledger/${e.target.value}`)} />
    </div>
  );
}
