import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

// Operators start on the scan screen; supervisors/admins on the dashboard.
export default async function Home() {
  const user = await getSessionUser();
  redirect(user?.role === "operator" ? "/scan" : "/dashboard");
}
