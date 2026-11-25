import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { ABOUT } from "@/components/app/about-copy";
import { CkbHeader } from "@/components/ckb/ui";
import { LicensesContent } from "@/components/legal/licenses-content";

export const metadata: Metadata = { title: "Lisensi" };

export default async function CkbLicensesPage() {
  await requireCkb("/ckb/lisensi");
  return (
    <main>
      <CkbHeader title={ABOUT.licensesTitle} back={{ href: "/ckb", label: "Beranda" }} />
      <LicensesContent />
    </main>
  );
}
