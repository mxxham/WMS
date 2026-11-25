import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { ABOUT } from "@/components/app/about-copy";
import { CkbHeader } from "@/components/ckb/ui";
import { PrivacyContent } from "@/components/legal/privacy-content";

export const metadata: Metadata = { title: "Privasi" };

export default async function CkbPrivacyPage() {
  await requireCkb("/ckb/privasi");
  return (
    <main>
      <CkbHeader title={ABOUT.privacyTitle} back={{ href: "/ckb", label: "Beranda" }} />
      <PrivacyContent />
    </main>
  );
}
