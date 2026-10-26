import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import type { StocktakeStatus, TaskStatus } from "./stocktake";

export type Session = {
  id: string; ref_no: string; customer_id: string; baseline_import_id: string; scope_type: "FULL" | "BINS" | "MATERIALS";
  scope_values: string[]; warehouse: string; blind: boolean; status: StocktakeStatus; notes: string | null;
  created_by_name: string; created_at: string; started_at: string | null; review_started_at: string | null;
  closed_at: string | null; closed_by_name: string | null; cancelled_at: string | null; cancel_reason: string | null;
  customer_name: string; baseline_ref: string; baseline_date: string; baseline_verified: boolean;
};

/** One row of ckb_stocktake_tasks(): baseline and variance are null when the viewer may not see them. */
export type TaskRow = {
  id: string; seq: number; origin: "BASELINE" | "FOUND"; material_code: string; description: string; plant: string;
  storage_location: string; storage_bin: string; batch: string; expiry_date: string | null; uom: string; stock_type: string;
  baseline_qty: number | null; baseline_rows: number; identity_issue: string | null; round: number; status: TaskStatus;
  count_rounds: number; count_total: number; latest_count_id: string | null; latest_qty: number | null; latest_counter: string | null;
  latest_counted_at: string | null; latest_batch_ok: boolean | null; latest_expiry_ok: boolean | null; accepted_qty: number | null;
  variance: number | null; classification: string; wrong_bin_hint: boolean | null; decision_reason: string | null;
  decided_by_name: string | null; decided_at: string | null;
};

/** The session header (RLS: staff, or a representative once CLOSED) — null when not visible. */
export async function loadSession(id: string): Promise<Session | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await createClient();
  const { data: s } = await db.from("ckb_stocktakes").select("*").eq("id", id).maybeSingle();
  if (!s) return null;
  const [{ data: c }, { data: i }] = await Promise.all([
    db.from("ckb_customers").select("name").eq("id", s.customer_id).maybeSingle(),
    db.from("ckb_sap_imports").select("ref_no, snapshot_date, mapping_verified").eq("id", s.baseline_import_id).maybeSingle(),
  ]);
  // Representatives cannot read snapshots: the baseline reference comes back empty for them.
  return { ...s, customer_name: c?.name ?? "–", baseline_ref: i?.ref_no ?? "–", baseline_date: i?.snapshot_date ?? "", baseline_verified: i?.mapping_verified ?? false };
}

export async function loadTasks(id: string): Promise<TaskRow[]> {
  const db = await createClient();
  return fetchAll<TaskRow>((a, b) => db.rpc("ckb_stocktake_tasks", { p_stocktake: id }).range(a, b));
}

export type CountRow = { id: string; task_id: string; entry_no: number; round: number; qty: number; batch_matches: boolean | null; expiry_matches: boolean | null;
  observed_batch: string | null; observed_expiry: string | null; note: string | null; counter_id: string; counter_name: string; counted_at: string };
export type NoteRow = { id: string; task_id: string; kind: string; note: string; by_name: string; at: string };

/** Every count and note of a session (staff only by RLS), oldest first. */
export async function loadHistory(taskIds: string[]): Promise<{ counts: CountRow[]; notes: NoteRow[] }> {
  if (taskIds.length === 0) return { counts: [], notes: [] };
  const db = await createClient();
  const counts: CountRow[] = [], notes: NoteRow[] = [];
  for (let i = 0; i < taskIds.length; i += 200) {
    const ids = taskIds.slice(i, i + 200);
    const [c, n] = await Promise.all([
      fetchAll<CountRow>((a, b) => db.from("ckb_counts").select("*").in("task_id", ids).order("entry_no").range(a, b)),
      fetchAll<NoteRow>((a, b) => db.from("ckb_task_notes").select("*").in("task_id", ids).order("at").order("id").range(a, b)),
    ]);
    counts.push(...c); notes.push(...n);
  }
  return { counts, notes };
}

export type TaskEvidence = { id: string; entity_id: string; kind: "GENERAL" | "DAMAGE" | "LABEL" | "DOCUMENT" | "DISCREPANCY"; mime: string; size_bytes: number;
  description: string | null; uploaded_by: string; uploaded_by_name: string; uploaded_at: string; legal_hold: boolean };

/** Evidence attached to count tasks, in chunks so the request URL stays short. */
export async function loadTaskEvidence(taskIds: string[]): Promise<TaskEvidence[]> {
  const db = await createClient();
  const out: TaskEvidence[] = [];
  for (let i = 0; i < taskIds.length; i += 100) {
    const { data, error } = await db.from("ckb_evidence").select("id, entity_id, kind, mime, size_bytes, description, uploaded_by, uploaded_by_name, uploaded_at, legal_hold")
      .eq("entity_type", "COUNT_TASK").in("entity_id", taskIds.slice(i, i + 100)).order("uploaded_at");
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as TaskEvidence[]));
  }
  return out;
}
