import { PageHeader } from "@/components/app/page-header";
import { ABOUT } from "@/components/app/about-copy";
import { PrivacyContent } from "@/components/legal/privacy-content";

export default function PrivacyPage() {
  return (
    <main>
      <PageHeader title={ABOUT.privacyTitle} />
      <PrivacyContent />
    </main>
  );
}
