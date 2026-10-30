import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "../../../../lib/admin";
import { channelAvailability } from "../../../../services/delivery";
import { channelStats, listAttempts } from "../../../../services/delivery/attempts";
import { whatsappTemplateName } from "../../../../services/delivery/whatsapp";

export const runtime = "nodejs";

/**
 * Admin "Delivery channels" data: per-channel flag + configuration state
 * (env presence only — values are never returned), the WhatsApp template
 * status, channel stats, and the latest delivery attempts.
 */
export async function GET(req: NextRequest) {
  if (!isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }
  const [channels, stats, attempts] = await Promise.all([
    channelAvailability(),
    channelStats(),
    listAttempts(50),
  ]);
  return NextResponse.json({
    channels,
    template: {
      name: whatsappTemplateName(),
      // Submission/approval happens in Meta Business Suite by the owner;
      // we can only report which template the store is configured to use.
      status: process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN ? "configured-name" : "not-configured",
    },
    stats,
    attempts: attempts.map((a) => ({
      id: a.id,
      orderId: a.orderId,
      channel: a.channel,
      status: a.status,
      errorCode: a.errorCode,
      grantId: a.grantId,
      createdAt: a.createdAt,
    })),
  });
}
