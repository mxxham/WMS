"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey } from "@/lib/supabase/keys";
import { offlineFetch } from "@/lib/net";

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabaseAnonKey(), {
    // Every client-side query and auth call goes through `offlineFetch`, so a
    // device without internet gets one Indonesian error instead of the
    // browser's raw "Failed to fetch" / "NetworkError when attempting to
    // fetch resource." wording inside `error.message`.
    global: { fetch: offlineFetch },
  });
}
