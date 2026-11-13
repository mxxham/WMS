// The Supabase dashboard now shows the publishable key (sb_publishable_…), while the legacy anon
// JWT keeps working for as long as it is enabled on the project. Accept either variable name so a
// key swap in the dashboard never needs a code change.
export function supabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
}
