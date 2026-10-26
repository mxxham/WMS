import { redirect } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";

/** The new-job form lives on the list page (a dialog); this address opens it. */
export default async function NewRebaggingPage() {
  await requireCkb("/ckb/rebagging/new");
  redirect("/ckb/rebagging?baru=1");
}
