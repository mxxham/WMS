import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { InventoryRow } from './adapters/inventory-stock';

/**
 * CLI-only database access (the web app goes through lib/supabase/*).
 * Uses the service-role key, so it must never be imported by browser code.
 */
function serviceClient() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const INVENTORY_COLUMNS =
  'bin_code, bin_status, sku, description, uom, upp, batch_lot, quantity, expiry_date, received_date';

/** Every inventory row, paged past PostgREST's 1,000-row limit. */
export async function loadInventoryRows(): Promise<InventoryRow[]> {
  const db = serviceClient();
  const out: InventoryRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('inventory_detail')
      .select(INVENTORY_COLUMNS)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as InventoryRow[]));
    if (!data || data.length < 1000) return out;
  }
}
