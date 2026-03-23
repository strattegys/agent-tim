import { NextRequest, NextResponse } from "next/server";

const BEEHIIV_API_KEY = process.env.BEEHIIV_API_KEY || "";
const BEEHIIV_PUB_ID = process.env.BEEHIIV_PUB_ID || "pub_f185705c-e383-43a3-bf39-40448f7087a3";
const BEEHIIV_BASE = "https://api.beehiiv.com/v2";

/**
 * POST /api/beehiiv
 *
 * Proxies requests to the Beehiiv API v2.
 * Ghost uses this to publish article drafts.
 *
 * Body: {
 *   action: "create_draft" | "list_posts" | "get_post",
 *   title?: string,
 *   subtitle?: string,
 *   content_html?: string,
 *   postId?: string,
 * }
 */
export async function POST(req: NextRequest) {
  if (!BEEHIIV_API_KEY) {
    return NextResponse.json(
      { error: "BEEHIIV_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "create_draft") {
      const { title, subtitle, content_html } = body;
      if (!title || !content_html) {
        return NextResponse.json(
          { error: "title and content_html are required" },
          { status: 400 }
        );
      }

      const res = await fetch(
        `${BEEHIIV_BASE}/publications/${BEEHIIV_PUB_ID}/posts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${BEEHIIV_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            subtitle: subtitle || undefined,
            body_content: content_html,
            status: "draft",
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error("[beehiiv] create_draft error:", res.status, errText);
        return NextResponse.json(
          { error: `Beehiiv API error: ${res.status}`, details: errText },
          { status: res.status }
        );
      }

      const data = await res.json();
      const postId = data?.data?.id;
      const webUrl = data?.data?.web_url;

      return NextResponse.json({
        ok: true,
        postId,
        webUrl,
        message: `Draft created: "${title}". Review at Beehiiv before publishing.`,
      });
    }

    if (action === "list_posts") {
      const res = await fetch(
        `${BEEHIIV_BASE}/publications/${BEEHIIV_PUB_ID}/posts?status=draft&limit=10`,
        {
          headers: { Authorization: `Bearer ${BEEHIIV_API_KEY}` },
        }
      );

      if (!res.ok) {
        return NextResponse.json(
          { error: `Beehiiv API error: ${res.status}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      const posts = (data?.data || []).map(
        (p: { id: string; title: string; status: string; web_url: string; created_at: string }) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          webUrl: p.web_url,
          createdAt: p.created_at,
        })
      );

      return NextResponse.json({ ok: true, posts });
    }

    if (action === "get_post") {
      const { postId } = body;
      if (!postId) {
        return NextResponse.json(
          { error: "postId is required" },
          { status: 400 }
        );
      }

      const res = await fetch(
        `${BEEHIIV_BASE}/publications/${BEEHIIV_PUB_ID}/posts/${postId}`,
        {
          headers: { Authorization: `Bearer ${BEEHIIV_API_KEY}` },
        }
      );

      if (!res.ok) {
        return NextResponse.json(
          { error: `Beehiiv API error: ${res.status}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      return NextResponse.json({ ok: true, post: data?.data });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("[beehiiv] error:", error);
    return NextResponse.json(
      { error: "Beehiiv API request failed" },
      { status: 500 }
    );
  }
}
