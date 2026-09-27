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
    const { error } = await supabase.from("settings").update({ value: layout, updated_at: new Date().toISOString() }).eq("key", "layout");
    if (error) return { error: error.message };
    const { data, error: e2 } = await supabase.rpc("recompute_bin_positions");
    if (e2) return { error: e2.message };
    revalidatePath("/warehouse");
    return { ok: `Layout disimpan. Koordinat ${data} bin dihitung ulang.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function setBinStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await admin();
    const codes = String(fd.get("codes") ?? "").split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const status = String(fd.get("status")) === "blocked" ? "blocked" : "active";
    const abc = String(fd.get("abc") ?? "");
    if (!codes.length) return { error: "Isi minimal satu kode bin." };
    const patch: Record<string, unknown> = { status };
    if (["A", "B", "C"].includes(abc)) patch.abc_class = abc;
    if (abc === "clear") patch.abc_class = null;
    const supabase = await createClient();
    const { data, error } = await supabase.from("bins").update(patch).in("bin_code", codes).select("bin_code");
    if (error) return { error: error.message };
    const missing = codes.filter((c) => !data?.some((d) => d.bin_code === c));
    return { ok: `${data?.length ?? 0} bin diperbarui.${missing.length ? ` Tidak ditemukan: ${missing.join(", ")}` : ""}` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function recomputeAbcAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await admin();
    const days = Math.max(7, Number(fd.get("days") ?? 90));
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("recompute_abc", { days });
    if (error) return { error: error.message };
    return { ok: `Kelas ABC ${data} SKU dihitung ulang dari picking ${days} hari terakhir.` };
  } catch (e) { return { error: (e as Error).message }; }
}
