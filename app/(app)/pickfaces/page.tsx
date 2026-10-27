import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { PickfacesClient } from "./pickfaces-client";

export default async function PickfacesPage() {
  await requirePage("/pickfaces");
  return (
    <main>
      <PageHeader title="Pickface per SKU" />
      <PickfacesClient />
    </main>
  );
}
