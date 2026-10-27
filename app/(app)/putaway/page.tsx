import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { PutawayClient } from "./putaway-client";

export default async function PutawayPage() {
  await requirePage("/putaway");
  return (
    <main>
      <PageHeader title="Putaway dari sheet" />
      <PutawayClient />
    </main>
  );
}
