import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirect } from "@/lib/auth-route";

// Every person signs in with their own account (spec 2026-10-12 login). This refreshes the session
// cookie and sends a signed-out request to /login (lib/auth-route.ts decides). getClaims verifies
// the JWT locally against the cached JWKS, refreshing it first if it is about to expire.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const to = authRedirect(request.nextUrl.pathname, request.nextUrl.search, !!data?.claims);
  if (!to) return response;
  const redirect = NextResponse.redirect(new URL(to, request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie.name, cookie.value, cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
