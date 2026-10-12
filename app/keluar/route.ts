import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loginRequired } from "@/lib/auth-route";

// Sign out: POST from the Keluar button; GET only from the app layout for an inactive account
// (never linked with <Link>, so nothing prefetches it). With login not required, "/" signs the
// device back in as the shared site account.
async function signOut(request: NextRequest) {
  await (await createClient()).auth.signOut();
  const url = new URL(loginRequired() ? "/login" : "/", request.url);
  if (request.nextUrl.searchParams.get("nonaktif")) { url.pathname = "/login"; url.searchParams.set("nonaktif", "1"); }
  return NextResponse.redirect(url, { status: 303 });
}
export const POST = signOut;
export const GET = signOut;
