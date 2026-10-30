import { NextRequest, NextResponse } from "next/server";
import { LOCALE_CODES, isLocale, matchLocale } from "./i18n/locales";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // API, Next internals and static files pass through untouched.
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }
  const first = pathname.split("/")[1] ?? "";
  if (isLocale(first)) return NextResponse.next();

  const cookieLocale = req.cookies.get("astralium-locale")?.value;
  const locale =
    cookieLocale && isLocale(cookieLocale)
      ? cookieLocale
      : matchLocale(req.headers.get("accept-language"));

  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export { LOCALE_CODES };
