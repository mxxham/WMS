import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { stocktakeCompletion, type ReportFilters, type ReportKind, type ReportRow } from "./reports";

/** Upper bound per report: a report larger than this says so instead of silently truncating. */
export const REPORT_LIMIT = 20000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Only well-formed filter values reach a query. */
export function cleanFilters(raw: Record<string, string | string[] | undefined>): ReportFilters {
  const one = (k: string) => { const v = raw[k]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
  const f: ReportFilters = {};
  const customer = one("customer"); if (customer && UUID.test(customer)) f.customer = customer;
  const stocktake = one("stocktake"); if (stocktake && UUID.test(stocktake)) f.stocktake = stocktake;
  const from = one("from"); if (from && DATE.test(from)) f.from = from;
  const to = one("to"); if (to && DATE.test(to)) f.to = to;
  for (const k of ["status", "classification", "type"] as const) { const v = one(k); if (v && /^[A-Z_]{2,40}$/.test(v)) f[k] = v; }
  for (const k of ["material", "location"] as const) { const v = one(k); if (v && v.length <= 40) f[k] = v; }
  return f;
}

const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export type LoadedReport = { rows: ReportRow[]; truncated: boolean };

/**
 * Rows of one report under the viewer's session. Representatives get only their customers' rows
 * (RLS on every table, ckb_report_discrepancies for count tasks) — the filters narrow, never widen.
 */
export async function loadReport(kind: ReportKind, f: ReportFilters): Promise<LoadedReport> {
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, name");
  const cname = new Map((customers ?? []).map((c) => [c.id as string, c.name as string]));
  let rows: ReportRow[] = [];

  if (kind === "stocktakes" || kind === "discrepancies" || kind === "recounts") {
    // The function orders by session date and task number, so pages are stable.
    let tasks = await fetchAll<ReportRow>((a, b) => db.rpc("ckb_report_discrepancies", {
      p_customer: f.customer ?? null, p_from: f.from ?? null, p_to: f.to ?? null,
      p_stocktake: f.stocktake ?? null, p_classification: kind === "discrepancies" && f.classification !== "ALL" ? (f.classification ?? null) : null,
    }).range(a, b));
    if (f.material) tasks = tasks.filter((t) => String(t.material_code).toUpperCase().includes(f.material!.toUpperCase()));
    if (f.location) tasks = tasks.filter((t) => String(t.storage_bin).toUpperCase().includes(f.location!.toUpperCase()));
    if (kind === "stocktakes") {
      rows = stocktakeCompletion(tasks);
      if (f.status) rows = rows.filter((r) => r.status === f.status);
    } else if (kind === "discrepancies") {
      // "ALL" = the whole session including matches (session export); otherwise matches are left out.
      rows = f.classification ? tasks : tasks.filter((t) => t.classification !== "MATCH");
    } else {
      rows = tasks.filter((t) => Number(t.count_rounds) > 1);
    }
    return { rows: rows.slice(0, REPORT_LIMIT), truncated: rows.length > REPORT_LIMIT };
  }

  const dated = <Q extends { gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(q: Q, col: string) => {
    let out = q;
    if (f.from) out = out.gte(col, f.from);
    if (f.to) out = out.lt(col, nextDay(f.to));
    return out;
  };

  if (kind === "adjustments") {
    rows = await fetchAll<ReportRow>((a, b) => {
      let q = db.from("ckb_adjustments").select("ref_no, customer_id, material_code, storage_bin, batch, uom, baseline_qty, accepted_qty, delta, status, decided_by_name, decided_at, decision_reason, proposed_at, ckb_stocktakes(ref_no)");
      if (f.customer) q = q.eq("customer_id", f.customer);
      if (f.status) q = q.eq("status", f.status);
      if (f.material) q = q.ilike("material_code", like(f.material));
      if (f.location) q = q.ilike("storage_bin", like(f.location));
      return dated(q, "proposed_at").order("proposed_at", { ascending: false }).order("ref_no").range(a, b);
    });
    rows = rows.map((r) => ({ ...r, stocktake_ref: (r.ckb_stocktakes as unknown as { ref_no: string } | null)?.ref_no ?? null, ckb_stocktakes: null }));
  } else if (kind === "rebagging") {
    rows = await fetchAll<ReportRow>((a, b) => {
      let q = db.from("ckb_rebagging_jobs").select("job_no, job_date, customer_id, customer, operation_type, status, input_qty, output_qty, unit, variance_qty, variance_reason, executor_name, verifier_name, created_at");
      if (f.customer) q = q.eq("customer_id", f.customer);
      if (f.status) q = q.eq("status", f.status);
      if (f.type) q = q.eq("operation_type", f.type);
      return dated(q, "job_date").order("job_date", { ascending: false }).order("job_no").range(a, b);
    });
  } else if (kind === "inspections") {
    rows = await fetchAll<ReportRow>((a, b) => {
      let q = db.from("ckb_inspections").select("ref_no, inspection_date, customer_id, inspection_type, source_ref, material_code, status, result, damage_class, inspector_name, reviewer_name, review_note");
      if (f.customer) q = q.eq("customer_id", f.customer);
      if (f.status) q = q.eq("status", f.status);
      if (f.type) q = q.eq("inspection_type", f.type);
      if (f.material) q = q.ilike("material_code", like(f.material));
      return dated(q, "inspection_date").order("inspection_date", { ascending: false }).order("ref_no").range(a, b);
    });
  } else if (kind === "activity") {
    rows = await fetchAll<ReportRow>((a, b) => {
      let q = db.from("ckb_audit_events").select("id, at, actor_name, action, entity_type, entity_id, customer_id, details");
      if (f.customer) q = q.eq("customer_id", f.customer);
      if (f.type) q = q.ilike("action", `${f.type}%`);
      return dated(q, "at").order("at", { ascending: false }).order("id", { ascending: false }).range(a, b);
    });
  } else if (kind === "sap_imports") {
    rows = await fetchAll<ReportRow>((a, b) => {
      let q = db.from("ckb_sap_import_summary").select("ref_no, customer_id, snapshot_date, file_name, row_count, rejected_count, duplicate_identity_count, total_qty, mapping_verified, is_active, imported_by_name, imported_at");
      if (f.customer) q = q.eq("customer_id", f.customer);
      return dated(q, "imported_at").order("imported_at", { ascending: false }).order("ref_no").range(a, b);
    });
  } else if (kind === "sap_exports") {
    rows = await fetchAll<ReportRow>((a, b) => {
      let q = db.from("ckb_sap_exports").select("ref_no, customer_id, kind, status, line_count, total_gain, total_loss, sap_document_ref, created_by_name, created_at, download_count, reason");
      if (f.customer) q = q.eq("customer_id", f.customer);
      if (f.status) q = q.eq("status", f.status);
      return dated(q, "created_at").order("created_at", { ascending: false }).order("ref_no").range(a, b);
    });
  }

  rows = rows.map((r) => ({ ...r, customer_name: r.customer_id ? cname.get(String(r.customer_id)) ?? null : (r.customer as string | null) ?? null }));
  return { rows: rows.slice(0, REPORT_LIMIT), truncated: rows.length > REPORT_LIMIT };
}
