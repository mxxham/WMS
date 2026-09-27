import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { PickfacesClient } from "./pickfaces-client";

export default async function PickfacesPage() {
  await requireRole(["supervisor", "admin"]);
  return (
    <main>
      <PageHeader title="Pickface per SKU" />
      <PickfacesClient />
    </main>
  );
}
