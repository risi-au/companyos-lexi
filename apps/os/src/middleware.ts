import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Protect all routes except auth and public static; redirect unauth to /sign-in
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow auth routes and next internals
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Use full session check (requires Node runtime in middleware for Next 15+)
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    const url = new URL("/sign-in", request.url);
    // Preserve original path for post-login redirect (simple, no deep state for M2-03)
    if (pathname !== "/") {
      url.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on Node for auth.api.getSession (db access)
  runtime: "nodejs",
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, etc.
     * - api/auth (auth endpoints)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
