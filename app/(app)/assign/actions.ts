"use server";
import { revalidatePath } from "next/cache";
import { checkPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** null on success, otherwise the message to show as-is (the RPCs raise Indonesian errors). */
export async function assignAction(date: string, shipment: string, userId: string, byName: string): Promise<string | null> {
  if (!(await checkPage("/assign"))) return "Anda tidak punya akses ke halaman ini.";
  const { error } = await (await createClient()).rpc("assign_shipment", { p_date: date, p_shipment: shipment, p_user: userId, p_by_name: byName });
  if (error) return error.message;
  revalidatePath("/assign");
  return null;
}

export async function unassignAction(date: string, shipment: string, byName: string): Promise<string | null> {
  if (!(await checkPage("/assign"))) return "Anda tidak punya akses ke halaman ini.";
  const { error } = await (await createClient()).rpc("unassign_shipment", { p_date: date, p_shipment: shipment, p_by_name: byName });
  if (error) return error.message;
  revalidatePath("/assign");
  return null;
}
