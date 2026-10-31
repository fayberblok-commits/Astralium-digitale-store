import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin, requireStepUp } from "../../../../../lib/team";
import { bankDetailsPresent, readVault, sanitizeBankDetails, writeVault } from "../../../../../lib/bank-vault";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Manager's Office — owner bank vault (Phase 4 upgrade, item 7).
 *
 * `bank` permission = the owner alone (see the matrix in lib/team.ts).
 * GET returns ONLY the masked view. Saving requires a fresh step-up
 * token on top of that. Plaintext is never returned here (the reveal
 * route does that, also step-up-gated), never logged, and never put in
 * an audit payload — audit entries record only that a save happened.
 * This vault is an archive/reference: payouts themselves are
 * configured inside Stripe/PayPal (the UI says so, verbatim).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "bank");
  if ("error" in auth) return auth.error;
  const vault = await readVault();
  if (vault.state === "empty") return NextResponse.json({ state: "empty" });
  if (vault.state === "unavailable") return NextResponse.json({ state: "unavailable", reason: vault.reason });
  return NextResponse.json({
    state: "ok",
    present: bankDetailsPresent(vault.details),
    masked: vault.masked,
    updatedAt: vault.updatedAt,
    updatedBy: vault.updatedBy,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "bank");
  if ("error" in auth) return auth.error;
  const stepUp = await requireStepUp(req, auth.actor);
  if ("error" in stepUp) return stepUp.error;
  let body: { details?: unknown } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const details = sanitizeBankDetails(body?.details);
  const res = await writeVault(details, auth.actor.actor);
  if (!res.ok) return NextResponse.json({ error: res.error ?? "VAULT_WRITE_FAILED" }, { status: 503 });
  await recordAudit({ actor: auth.actor, action: "office.bank_save", target: "bank-vault" });
  const vault = await readVault();
  return NextResponse.json({
    ok: true,
    persisted: res.persisted,
    masked: vault.state === "ok" ? vault.masked : null,
    updatedAt: vault.state === "ok" ? vault.updatedAt : null,
  });
}
