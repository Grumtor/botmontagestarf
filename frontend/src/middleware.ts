import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 30 — Auth middleware.
 *
 * If the session cookie isn't present, redirect to /login. The real
 * cryptographic check happens server-side on every API call ; this is
 * just a quick UX gate so unauthenticated users don't see a flash of
 * the UI before being kicked out.
 *
 * Bypassed paths :
 *   - /login itself (would loop forever)
 *   - /_next/* (static assets)
 *   - /favicon.ico etc.
 *   - /api/* (the backend handles its own auth ; frontend proxy
 *             rewrites send these straight through)
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Bypass — these must always be reachable.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // Cookie name MUST match backend's `COOKIE_NAME` (app/auth.py).
  const sessionCookie = req.cookies.get("bm_session");

  if (!sessionCookie || !sessionCookie.value) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Run on every path except static files. Next picks this up from the
// exported `config` object automatically.
export const config = {
  matcher: [
    // Skip Next internals + files with extensions (assets).
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.).*)",
  ],
};
