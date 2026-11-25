"use server";
import { revalidatePath } from "next/cache";
import { checkRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok?: string; error?: string };

async function admin() {
  const u = await checkRole(["admin"]);
  if (!u) throw new Error("Hanya admin.");
  return u;
}

export async function saveLayoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await admin();
    const num = (k: string) => { const v = Number(fd.get(k)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${k} harus angka > 0`); return v; };
    const layout = {
      aisle_order: String(fd.get("aisle_order")).split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
      bay_width_m: num("bay_width_m"), rack_depth_m: num("rack_depth_m"), level_height_m: num("level_height_m"),
      aisle_width_m: num("aisle_width_m"), positions_per_bay: num("positions_per_bay"),
      bays_per_side: (() => { const v = Number(fd.get("bays_per_side") ?? 0); if (!Number.isInteger(v) || v < 0) throw new Error("bays_per_side harus bilangan bulat ≥ 0"); return v; })(),
      floor_zone_origin: { x: Number(fd.get("floor_x") ?? 0), z: Number(fd.get("floor_z") ?? -8) },
    };
    const supabase = await createClient();
    // 0148: the Block C section (origin, slot pitch, lane gap, pallet height, lane order) is kept, and edited when the form
    // sends it. Writing the layout without it would drop the lane order and reset every dimension to its default.
    const { data: current } = await supabase.from("settings").select("value").eq("key", "layout").maybeSingle();
    const prev = (current?.value as { block_c?: Record<string, unknown> } | null)?.block_c;
    const optNum = (k: string, fallback: unknown) => {
      const raw = fd.get(k);
      if (raw === null || String(raw).trim() === "") return fallback;
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`${k} harus angka`);
      return v;
    };
    const prevOrigin = (prev?.origin ?? { x: 0, z: 70 }) as { x: number; z: number };
    const block_c = {
      lanes: ["FA", "FB"], ...(prev ?? {}),
      origin: { x: optNum("block_c_x", prevOrigin.x), z: optNum("block_c_z", prevOrigin.z) },
      slot_pitch_m: optNum("block_c_pitch", prev?.slot_pitch_m ?? 2.6),
      lane_gap_m: optNum("block_c_gap", prev?.lane_gap_m ?? 10),
      slot_depth_m: optNum("block_c_depth", prev?.slot_depth_m ?? 7),
      pallet_height_m: optNum("block_c_pallet", prev?.pallet_height_m ?? 1.2),
    };
    for (const [k, v] of [["jarak antar slot", block_c.slot_pitch_m], ["jarak FA ke FB", block_c.lane_gap_m], ["kedalaman slot", block_c.slot_depth_m], ["tinggi palet", block_c.pallet_height_m]] as const) {
      if (!(Number(v) > 0)) throw new Error(`Block C: ${k} harus lebih dari 0`);
    }
    const { error } = await supabase.from("settings").update({ value: { ...layout, block_c }, updated_at: new Date().toISOString() }).eq("key", "layout");
    if (error) return { error: error.message };
    const { data, error: e2 } = await supabase.rpc("recompute_bin_positions");
    if (e2) return { error: e2.message };
    revalidatePath("/warehouse");
    return { ok: `Layout disimpan. Koordinat ${data} bin dihitung ulang.` };
  } catch (e) { return { error: (e as Error).message }; }
}
