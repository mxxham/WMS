import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { PutawayClient } from "./putaway-client";

export default async function PutawayPage() {
  await requireRole(["supervisor", "admin"]);
  return (
    <main>
      <PageHeader title="Putaway dari sheet" />
      <PutawayClient />
    </main>
  );
}
