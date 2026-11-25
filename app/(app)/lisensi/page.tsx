import { PageHeader } from "@/components/app/page-header";
import { ABOUT } from "@/components/app/about-copy";
import { LicensesContent } from "@/components/legal/licenses-content";

export default function LicensesPage() {
  return (
    <main>
      <PageHeader title={ABOUT.licensesTitle} />
      <LicensesContent />
    </main>
  );
}
