import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
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
  // The shared site account carries app_metadata.shared (0072; set below on first use elsewhere).
  // A token issued before the flag was set lacks it until its hourly refresh, so the site-account
  // email (still set when login is switched on) is checked too.
  const siteEmail = process.env.SITE_ACCOUNT_EMAIL?.toLowerCase();
  const isShared = (data?.claims?.app_metadata as { shared?: boolean } | undefined)?.shared === true
    || (!!siteEmail && typeof data?.claims?.email === "string" && data.claims.email.toLowerCase() === siteEmail);
  const route = authRoute(request.nextUrl.pathname, request.nextUrl.search, !!data?.claims, loginRequired(), isShared);
  if (route.kind === "continue") return response;

  let to: URL;
  if (route.kind === "shared") {
    const email = process.env.SITE_ACCOUNT_EMAIL, password = process.env.SITE_ACCOUNT_PASSWORD;
    const signIn = email && password ? await supabase.auth.signInWithPassword({ email, password }) : null;
    if (!signIn || signIn.error || !signIn.data.user) return new NextResponse("Situs belum dikonfigurasi (SITE_ACCOUNT_EMAIL / SITE_ACCOUNT_PASSWORD).", { status: 503 });
    const user = signIn.data.user;
    if (user.app_metadata?.shared !== true) {
      // Mark the shared account once, so it is recognised after the site-account variables are gone.
      await createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
        .auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, shared: true } });
    }
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
