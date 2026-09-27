import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Every visitor uses one shared site session (SITE_ACCOUNT_EMAIL /
// SITE_ACCOUNT_PASSWORD, set in the host's environment). The database still
// sees a real account, so RLS, role checks and the ledger author work as usual.
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
  // getClaims verifies the JWT locally against the cached JWKS (asymmetric
  // signing keys), refreshing it first if it is about to expire. getUser would
  // add a round trip to the Auth server on every request.
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) return response;

  const email = process.env.SITE_ACCOUNT_EMAIL, password = process.env.SITE_ACCOUNT_PASSWORD;
  const { error } = email && password ? await supabase.auth.signInWithPassword({ email, password }) : { error: true };
  if (error) return new NextResponse("Situs belum dikonfigurasi (SITE_ACCOUNT_EMAIL / SITE_ACCOUNT_PASSWORD).", { status: 503 });

  // The session cookies were written onto `response`; carry them onto a
  // redirect to this same path so the next request has the session.
  const redirect = NextResponse.redirect(request.nextUrl.clone());
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie.name, cookie.value, cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
