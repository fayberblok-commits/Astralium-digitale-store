/**
 * Unified delivery core (Phase 2).
 *
 * Every channel implements DeliveryChannel. The orchestrator
 * (services/delivery/index.ts) tries the customer's chosen channel,
 * records EVERY attempt, retries safely, and falls back to email —
 * the always-available base channel — on failure or timeout.
 *
 * Only the store's own signed download links are ever sent. Raw storage
 * URLs never leave the server (see lib/tokens.ts + services/storage.ts).
 */

export type DeliveryChannelKey = "email" | "whatsapp" | "messenger" | "instagram";

export interface DeliveryItem {
  productId: string;
  title: string;
  /** Absolute URL of the store's signed download endpoint. */
  downloadUrl: string;
}

export interface DeliveryContext {
  orderId: string;
  /** Logical grant (order + items digest) — idempotency scope with orderId+channel. */
  grantId: string;
  email?: string | null;
  /** E.164 phone for WhatsApp proactive sends. */
  phoneE164?: string | null;
  /** Platform recipient id: wa_id (digits), PSID (Messenger) or IGSID (Instagram). */
  recipientId?: string | null;
  items: DeliveryItem[];
  locale?: string;
  /** True when we are inside the platform's 24h service window (reply context). */
  freeForm?: boolean;
}

export interface DeliveryResult {
  ok: boolean;
  status: "sent" | "delivered" | "queued" | "failed";
  providerMessageId?: string;
  /** Provider error code only — never message bodies or recipient data. */
  errorCode?: string;
  retryable?: boolean;
}

export interface DeliveryChannel {
  key: DeliveryChannelKey;
  /** Feature-flag state (DB-backed when configured). */
  isEnabled(): Promise<boolean>;
  /** All required env keys present. */
  isConfigured(): boolean;
  /** Env keys that are missing (names only, never values). */
  missingEnv(): string[];
  send(ctx: DeliveryContext): Promise<DeliveryResult>;
}

/** What the orchestrator needs to deliver an order on any channel. */
export interface DeliverableOrder {
  orderId: string;
  email?: string | null;
  phoneE164?: string | null;
  recipientId?: string | null;
  productIds: string[];
  locale?: string;
  freeForm?: boolean;
}
