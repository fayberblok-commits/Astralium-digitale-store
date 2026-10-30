import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ---------------------------------- catalog --------------------------------- */

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    titleEn: text("title_en"),
    subtitle: text("subtitle"),
    subtitleEn: text("subtitle_en"),
    description: text("description").notNull(),
    descriptionEn: text("description_en"),
    category: text("category").notNull().default("ebook"),
    priceCents: integer("price_cents").notNull().default(0),
    compareAtCents: integer("compare_at_cents"),
    coverStyle: text("cover_style").notNull().default("nebula"),
    coverGlyph: text("cover_glyph").notNull().default("✦"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    featuresEn: jsonb("features_en").$type<string[]>().notNull().default([]),
    format: text("format").notNull().default("Digital"),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    fileSizeKb: integer("file_size_kb"),
    downloadLimit: integer("download_limit").notNull().default(5),
    status: text("status").notNull().default("active"),
    featured: boolean("featured").notNull().default(false),
    salesCount: integer("sales_count").notNull().default(0),
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("products_slug_uq").on(table.slug), index("products_status_idx").on(table.status)],
);

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  authorName: text("author_name").notNull(),
  rating: integer("rating").notNull().default(5),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull().default("أخبار"),
    coverStyle: text("cover_style").notNull().default("nebula"),
    published: boolean("published").notNull().default(true),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("blog_slug_uq").on(table.slug)],
);

/* --------------------------------- customers -------------------------------- */

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    locale: text("locale").notNull().default("ar"),
    country: text("country"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    referralCode: text("referral_code").notNull(),
    referredBy: text("referred_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("customers_email_uq").on(table.email), uniqueIndex("customers_referral_uq").on(table.referralCode)],
);

export const customerSessions = pgTable("customer_sessions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/* ---------------------------------- orders ---------------------------------- */

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: text("order_number").notNull(),
    customerId: integer("customer_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    country: text("country").notNull().default("SA"),
    locale: text("locale").notNull().default("ar"),
    currency: text("currency").notNull().default("USD"),
    fxRate: text("fx_rate").notNull().default("1"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    baseSubtotalCents: integer("base_subtotal_cents").notNull().default(0),
    baseTotalCents: integer("base_total_cents").notNull().default(0),
    couponCode: text("coupon_code"),
    status: text("status").notNull().default("pending"),
    paymentProvider: text("payment_provider").notNull().default("sandbox"),
    paymentRef: text("payment_ref"),
    accessToken: text("access_token").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("orders_number_uq").on(table.orderNumber), index("orders_email_idx").on(table.email)],
);

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id").notNull(),
  titleSnapshot: text("title_snapshot").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull().default(1),
  downloadCount: integer("download_count").notNull().default(0),
  downloadLimit: integer("download_limit").notNull().default(5),
});

export const coupons = pgTable(
  "coupons",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    kind: text("kind").notNull().default("percent"),
    value: integer("value").notNull().default(10),
    minSubtotalCents: integer("min_subtotal_cents").notNull().default(0),
    maxRedemptions: integer("max_redemptions"),
    redemptions: integer("redemptions").notNull().default(0),
    active: boolean("active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("coupons_code_uq").on(table.code)],
);

export const emailOutbox = pgTable("email_outbox", {
  id: serial("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull().default("transactional"),
  status: text("status").notNull().default("queued"),
  orderNumber: text("order_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------------- support ---------------------------------- */

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    ticketNumber: text("ticket_number").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    orderNumber: text("order_number"),
    locale: text("locale").notNull().default("ar"),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tickets_number_uq").on(table.ticketNumber)],
);

export const ticketMessages = pgTable("ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  author: text("author").notNull().default("customer"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const faqs = pgTable("faqs", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category").notNull().default("general"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/* ------------------------------- ai employees ------------------------------- */

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    team: text("team").notNull().default("customer"),
    specialty: text("specialty").notNull(),
    glyph: text("glyph").notNull().default("✦"),
    accent: text("accent").notNull().default("gold"),
    greeting: text("greeting").notNull(),
    greetingEn: text("greeting_en"),
    instructions: text("instructions").notNull().default(""),
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    conversations: integer("conversations").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("agents_slug_uq").on(table.slug)],
);

export const aiConversations = pgTable("ai_conversations", {
  id: serial("id").primaryKey(),
  agentSlug: text("agent_slug").notNull(),
  channel: text("channel").notNull().default("store"),
  locale: text("locale").notNull().default("ar"),
  customerEmail: text("customer_email"),
  escalated: boolean("escalated").notNull().default(false),
  transcript: jsonb("transcript").$type<{ role: string; content: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------------- admin/security --------------------------- */

export const adminUsers = pgTable(
  "admin_users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    totpSecret: text("totp_secret").notNull(),
    totpEnabled: boolean("totp_enabled").notNull().default(true),
    role: text("role").notNull().default("owner"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("admin_email_uq").on(table.email)],
);

export const adminSessions = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("admin"),
  identifier: text("identifier").notNull(),
  ip: text("ip"),
  success: boolean("success").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actor: text("actor").notNull().default("owner"),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    kind: text("kind").notNull().default("payment"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("processed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("webhook_event_uq").on(table.provider, table.eventId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactMessages = pgTable("contact_messages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  handled: boolean("handled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    locale: text("locale").notNull().default("ar"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("newsletter_email_uq").on(table.email)],
);

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type AiAgent = typeof aiAgents.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type BlogPost = typeof blogPosts.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
