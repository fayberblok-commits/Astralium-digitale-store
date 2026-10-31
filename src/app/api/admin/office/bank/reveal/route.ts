import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin, requireStepUp } from "../../../../../../lib/team";
import { readVault } from "../../../../../../lib/bank-vault";

export const runtime = "nodejs";

/**
 * Manager's Office — bank vault reveal (Phase 4 upgrade, item 7).
 * The ONLY route that returns plaintext bank details: owner-only
 * `bank` permission + a fresh step-up token, no-store caching, and an
 * audit entry that records the reveal event (never the data).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "bank");
  if ("error" in auth) return auth.error;
  const stepUp = await requireStepUp(req, auth.actor);
  if ("error" in stepUp) return stepUp.error;
  const vault = await readVault();
  if (vault.state !== "ok") {
    return NextResponse.json({ error: vault.state === "empty" ? "VAULT_EMPTY" : vault.reason }, { status: 404 });
  }
  await recordAudit({ actor: auth.actor, action: "office.bank_reveal", target: "bank-vault" });
  return NextResponse.json(
    { details: vault.details, updatedAt: vault.updatedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
