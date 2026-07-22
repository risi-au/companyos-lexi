import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic auth gate: cookie presence only (no DB — middleware runs on the
// edge runtime, where postgres connections hang). Real session validation
// happens server-side in the (app) layout via auth.api.getSession; this just
// keeps anonymous users off app routes.
//
// Authenticated `/` must redirect to `/digest` here (not via a pure server
// page under `(app)`). Next.js 15.5.x can 500 on server-only pages that omit
// clientReferenceManifest; hitting `/` after login was the production failure.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow auth routes and next internals
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/v1") ||   // agent API: bearer-token auth in route handlers
    pathname.startsWith("/api/webhooks") || // GitHub/Plane webhooks: signature auth in route handlers
    pathname.startsWith("/api/mcp") ||  // remote MCP: bearer-token auth in route handler (M6-01)
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/change-password") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Auth errors (e.g. from /api/auth/error) bounce to `/?error=...`; without this
  // the error query is dropped by the `/` -> `/digest` (or -> `/sign-in`) redirects
  // below and the user dead-ends with no message (#90). Route it to /sign-in, which
  // renders the error.
  const authError = request.nextUrl.searchParams.get("error");
  if (authError) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("error", authError);
    const desc = request.nextUrl.searchParams.get("error_description");
    if (desc) url.searchParams.set("error_description", desc);
    return NextResponse.redirect(url);
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/sign-in", request.url);
    // Preserve original path for post-login redirect (simple, no deep state for M2-03)
    if (pathname !== "/") {
      url.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(url);
  }

  // Signed-in home: never render a page at `/` — go straight to the root scope.
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/digest", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
