import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ImportClient } from "./import-client";

export default async function ImportPage() {
  await requireRole(["admin"]);
  return (
    <main>
      <PageHeader title="Import data WMS" />
      <ImportClient />
    </main>
  );
}
