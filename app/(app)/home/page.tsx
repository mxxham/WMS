import { requireRole } from "@/lib/auth";
import { HomePage } from "@/components/home/home-page";

// Home: opened from the logo. "/" still sends each role to its start screen (Scan or Dashboard).
export default async function Home() {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  return <HomePage role={user.role} />;
}
