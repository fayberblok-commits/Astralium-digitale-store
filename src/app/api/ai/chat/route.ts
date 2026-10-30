import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiAgents, aiConversations, products } from "@/db/schema";
import { generateAgentReply, refineWithModel, type ChatMessage } from "@/lib/ai";
import { isLocale, type LocaleCode } from "@/lib/i18n";

const buckets = new Map<string, { count: number; reset: number }>();

function throttle(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + 60_000 });
    return true;
  }
  if (bucket.count >= 20) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!throttle(ip)) {
    return NextResponse.json({ error: "محاولات كثيرة. انتظر دقيقة ثم حاول مجددًا." }, { status: 429 });
  }

  let body: { agentSlug?: string; messages?: ChatMessage[]; locale?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح." }, { status: 400 });
  }

  const agentSlug = String(body.agentSlug ?? "");
  const locale: LocaleCode = isLocale(body.locale) ? body.locale : "ar";
  const messages = (body.messages ?? [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .slice(-10)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 1500) }));

  if (!agentSlug || messages.length === 0) {
    return NextResponse.json({ error: "بيانات المحادثة غير مكتملة." }, { status: 400 });
  }

  const agentRows = await db
    .select()
    .from(aiAgents)
    .where(and(eq(aiAgents.slug, agentSlug), eq(aiAgents.team, "customer"), eq(aiAgents.active, true)))
    .limit(1);
  const agent = agentRows[0];
  if (!agent) {
    // Manager-only employees are never exposed to buyers.
    return NextResponse.json({ error: "هذا الموظف غير متاح للعملاء." }, { status: 404 });
  }

  const catalog = await db
    .select()
    .from(products)
    .where(eq(products.status, "active"))
    .limit(60);

  const draft = generateAgentReply({
    agent: {
      slug: agent.slug,
      name: agent.name,
      title: agent.title,
      specialty: agent.specialty,
      team: agent.team,
      greeting: agent.greeting,
      greetingEn: agent.greetingEn,
      instructions: agent.instructions,
    },
    messages,
    locale,
    catalog: catalog.map((item) => ({
      slug: item.slug,
      title: item.title,
      titleEn: item.titleEn,
      subtitle: item.subtitle,
      subtitleEn: item.subtitleEn,
      description: item.description,
      category: item.category,
      priceCents: item.priceCents,
      coverStyle: item.coverStyle,
      coverGlyph: item.coverGlyph,
      tags: item.tags,
    })),
  });

  const reply = await refineWithModel({
    agent: { ...agent, instructions: agent.instructions },
    messages,
    locale,
    catalog: catalog.map((item) => ({
      slug: item.slug,
      title: item.title,
      titleEn: item.titleEn,
      subtitle: item.subtitle,
      subtitleEn: item.subtitleEn,
      description: item.description,
      category: item.category,
      priceCents: item.priceCents,
      coverStyle: item.coverStyle,
      coverGlyph: item.coverGlyph,
      tags: item.tags,
    })),
    draft,
  });

  try {
    await db.insert(aiConversations).values({
      agentSlug: agent.slug,
      channel: "store",
      locale,
      escalated: reply.escalate,
      transcript: [...messages, { role: "assistant", content: reply.reply }].slice(-12),
    });
    await db
      .update(aiAgents)
      .set({ conversations: sql`${aiAgents.conversations} + 1` })
      .where(eq(aiAgents.id, agent.id));
  } catch {
    /* logging is best-effort and must never break the reply */
  }

  return NextResponse.json({
    reply: reply.reply,
    quickReplies: reply.quickReplies,
    recommendations: reply.recommendations,
    escalate: reply.escalate,
    language: reply.language,
  });
}
