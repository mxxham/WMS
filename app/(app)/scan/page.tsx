import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ScanClient } from "./scan-client";

export default async function ScanPage() {
  await requirePage("/scan");
  return (
    <main>
      <PageHeader title="Scan bin" />
      <ScanClient />
    </main>
  );
}
