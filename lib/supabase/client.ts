"use client";
import { createBrowserClient } from "@supabase/ssr";
import { offlineFetch } from "@/lib/net";

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    // Every client-side query and auth call goes through `offlineFetch`, so a
    // device without internet gets one Indonesian error instead of the
    // browser's raw "Failed to fetch" / "NetworkError when attempting to
    // fetch resource." wording inside `error.message`.
    global: { fetch: offlineFetch },
  });
}
