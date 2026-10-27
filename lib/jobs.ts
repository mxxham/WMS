import type { Role } from "@/lib/types";

/** The seven flowchart jobs (profiles.job, 0109). Order is the order of the Pengguna dropdown. */
export type Job = "admin_inbound" | "admin_outbound" | "checker" | "inventory" | "operator" | "leader" | "admin";

export const JOBS: readonly Job[] = ["admin_inbound", "admin_outbound", "checker", "inventory", "operator", "leader", "admin"];

export const JOB_LABEL: Record<Job, string> = {
  admin_inbound: "Admin Inbound",
  admin_outbound: "Admin Outbound",
  checker: "Checker",
  inventory: "Inventory",
  operator: "Operator / Picker",
  leader: "Leader",
  admin: "Admin",
};

/** What a job may do inside a page follows its level (the old role). */
export function jobLevel(j: Job): Role {
  if (j === "admin") return "admin";
  if (j === "checker" || j === "operator") return "operator";
  return "supervisor";
}
