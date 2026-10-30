import { NextRequest, NextResponse } from "next/server";
import { answerSupport } from "../../../../services/ai-support";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { message?: string; locale?: string } | null;
  const message = (body?.message ?? "").trim().slice(0, 1000);
  if (!message) {
    return NextResponse.json({ error: "EMPTY_MESSAGE" }, { status: 400 });
  }
  const answer = await answerSupport(message);
  return NextResponse.json(answer);
}
