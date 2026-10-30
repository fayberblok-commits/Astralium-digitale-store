import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionToken, checkAdminPassword, adminConfigured } from "../../../../lib/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || !checkAdminPassword(body.password)) {
    return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 401 });
  }
  const token = adminSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8-hour admin sessions
  });
  return res;
}
