import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, type Permission } from "../../../../lib/team";
import { deleteBlogPost, listBlogPosts, saveBlogPost } from "../../../../lib/blog";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

// Phase 6 (feature 29): role-based guard — GET needs "read", mutations
// need this route's permission (see the matrix in lib/team.ts). The
// ADMIN_PASSWORD bootstrap session acts as owner and passes everything.
async function guard(req: NextRequest, permission: Permission): Promise<Response | null> {
  const res = await requireAdmin(req, permission);
  return "error" in res ? res.error : null;
}

/** Blog administration (Phase 5, feature 21): all posts incl. drafts. */
export async function GET(req: NextRequest) {
  const denied = await guard(req, "read");
  if (denied) return denied;
  const posts = await listBlogPosts();
  return NextResponse.json({ posts });
}

/** Create or update a post (draft unless explicitly published). */
export async function POST(req: NextRequest) {
  const denied = await guard(req, "content");
  if (denied) return denied;
  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const result = await saveBlogPost(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, persisted: result.persisted, post: result.post });
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req, "content");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const result = await deleteBlogPost(id);
  if (!result.ok) return NextResponse.json({ error: "POST_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
