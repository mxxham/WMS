import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { AllocateClient } from "./allocate-client";

export default async function AllocatePage() {
  await requireRole(["supervisor", "admin"]);
  return (
    <main>
      <PageHeader title="Alokasi FEFO & picklist" />
      <AllocateClient />
    </main>
  );
}
