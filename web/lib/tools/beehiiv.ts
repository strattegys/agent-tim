import type { ToolModule } from "./types";

const BEEHIIV_API_KEY = process.env.BEEHIIV_API_KEY || "";
const BEEHIIV_PUB_ID =
  process.env.BEEHIIV_PUB_ID || "pub_f185705c-e383-43a3-bf39-40448f7087a3";
const BEEHIIV_BASE = "https://api.beehiiv.com/v2";

const tool: ToolModule = {
  metadata: {
    id: "beehiiv",
    displayName: "Beehiiv",
    category: "external",
    description:
      "Publish articles as drafts to Beehiiv newsletter. Ghost uses this after an article passes human review.",
    externalSystem: "Beehiiv API v2",
    operations: ["create_draft", "list_drafts", "get_post"],
    requiresApproval: false,
  },

  declaration: {
    name: "beehiiv",
    description:
      "Publish content to Beehiiv newsletter. Supports creating drafts, listing existing drafts, and retrieving post details.",
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description:
            'Action to perform: "create_draft" to publish an article as a draft, "list_drafts" to see existing drafts, "get_post" to get details of a specific post',
        },
        title: {
          type: "string",
          description: "Article title (required for create_draft)",
        },
        subtitle: {
          type: "string",
          description: "Article subtitle (optional, for create_draft)",
        },
        content_html: {
          type: "string",
          description:
            "Article body as HTML (required for create_draft). Use proper HTML tags for formatting.",
        },
        post_id: {
          type: "string",
          description: "Beehiiv post ID (required for get_post)",
        },
      },
      required: ["action"],
    },
  },

  async execute(args) {
    if (!BEEHIIV_API_KEY) {
      return JSON.stringify({
        error: "BEEHIIV_API_KEY not configured. Set it in the environment.",
      });
    }

    const { action } = args;

    if (action === "create_draft") {
      if (!args.title || !args.content_html) {
        return JSON.stringify({
          error: "title and content_html are required for create_draft",
        });
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
            title: args.title,
            subtitle: args.subtitle || undefined,
            body_content: args.content_html,
            status: "draft",
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        return JSON.stringify({
          error: `Beehiiv API error ${res.status}`,
          details: errText,
        });
      }

      const data = await res.json();
      return JSON.stringify({
        ok: true,
        postId: data?.data?.id,
        webUrl: data?.data?.web_url,
        message: `Draft "${args.title}" created on Beehiiv. Review and publish from the Beehiiv dashboard.`,
      });
    }

    if (action === "list_drafts") {
      const res = await fetch(
        `${BEEHIIV_BASE}/publications/${BEEHIIV_PUB_ID}/posts?status=draft&limit=10`,
        {
          headers: { Authorization: `Bearer ${BEEHIIV_API_KEY}` },
        }
      );

      if (!res.ok) {
        return JSON.stringify({ error: `Beehiiv API error ${res.status}` });
      }

      const data = await res.json();
      const posts = (data?.data || []).map(
        (p: {
          id: string;
          title: string;
          status: string;
          web_url: string;
        }) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          webUrl: p.web_url,
        })
      );
      return JSON.stringify({ ok: true, drafts: posts });
    }

    if (action === "get_post") {
      if (!args.post_id) {
        return JSON.stringify({ error: "post_id is required for get_post" });
      }

      const res = await fetch(
        `${BEEHIIV_BASE}/publications/${BEEHIIV_PUB_ID}/posts/${args.post_id}`,
        {
          headers: { Authorization: `Bearer ${BEEHIIV_API_KEY}` },
        }
      );

      if (!res.ok) {
        return JSON.stringify({ error: `Beehiiv API error ${res.status}` });
      }

      const data = await res.json();
      const p = data?.data;
      return JSON.stringify({
        ok: true,
        post: {
          id: p?.id,
          title: p?.title,
          subtitle: p?.subtitle,
          status: p?.status,
          webUrl: p?.web_url,
          createdAt: p?.created_at,
        },
      });
    }

    return JSON.stringify({ error: `Unknown action: ${action}` });
  },
};

export default tool;
