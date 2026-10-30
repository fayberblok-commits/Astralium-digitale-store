import { NextResponse, type NextRequest } from "next/server";
import { detectLocale } from "@/lib/i18n";

const LOCALE_COOKIE = "astralium_locale";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Auto-detect visitor language once, then respect explicit choice.
  if (!request.cookies.get(LOCALE_COOKIE)?.value) {
    const detected = detectLocale(request.headers.get("accept-language"));
    response.cookies.set(LOCALE_COOKIE, detected, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  // Defence in depth: office routes require a session cookie at the edge.
  const path = request.nextUrl.pathname;
  if (path.startsWith("/admin") && path !== "/admin/login") {
    const session = request.cookies.get("astralium_admin_session")?.value;
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-DNS-Prefetch-Control", "on");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images|.*\\.(?:svg|png|jpg|jpeg|webp|txt|xml)$).*)"],
};
