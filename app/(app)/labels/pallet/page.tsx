import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { PalletClient } from "./pallet-client";

export default async function PalletCardsPage() {
  await requireRole(["supervisor", "admin"]);
  return (
    <main>
      <PageHeader title="Cetak kartu palet" />
      <PalletClient />
    </main>
  );
}
