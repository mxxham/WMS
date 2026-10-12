import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRoute, loginRequired } from "@/lib/auth-route";

// Sign-in (spec 2026-10-12 login + revision). LOGIN_REQUIRED=true: everyone signs in with their own
// account at /login. Otherwise (today): a request without a session is signed in as the shared site
// account (SITE_ACCOUNT_EMAIL / SITE_ACCOUNT_PASSWORD), and /login stays open so anyone can sign in
// as themselves. lib/auth-route.ts decides; getClaims verifies the JWT locally against the cached
// JWKS, refreshing it first if it is about to expire.
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
  const route = authRoute(request.nextUrl.pathname, request.nextUrl.search, !!data?.claims, loginRequired());
  if (route.kind === "continue") return response;

  let to: URL;
  if (route.kind === "shared") {
    const email = process.env.SITE_ACCOUNT_EMAIL, password = process.env.SITE_ACCOUNT_PASSWORD;
    const { error } = email && password ? await supabase.auth.signInWithPassword({ email, password }) : { error: true };
    if (error) return new NextResponse("Situs belum dikonfigurasi (SITE_ACCOUNT_EMAIL / SITE_ACCOUNT_PASSWORD).", { status: 503 });
    to = request.nextUrl.clone(); // the same page, now with the session
  } else {
    to = new URL(route.to, request.url);
  }
  // Session cookies were written onto `response`; carry them onto the redirect.
  const redirect = NextResponse.redirect(to);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie.name, cookie.value, cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
