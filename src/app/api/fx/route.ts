import { NextResponse } from "next/server";
import { getRates } from "../../../lib/currency";

export const runtime = "nodejs";

/** Cached FX table (USD base). Swap getRates() for a live provider later. */
export async function GET() {
  return NextResponse.json(getRates(), {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
