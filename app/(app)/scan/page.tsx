import { PageHeader } from "@/components/app/page-header";
import { ScanClient } from "./scan-client";

export default function ScanPage() {
  return (
    <main>
      <PageHeader title="Scan bin" />
      <ScanClient />
    </main>
  );
}
