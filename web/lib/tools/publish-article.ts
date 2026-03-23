import type { ToolModule } from "./types";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";

const CONTENT_PATH = process.env.SITE_CONTENT_PATH || "/root/apps/site/content/articles";
const REVALIDATE_URL = process.env.SITE_REVALIDATE_URL || "http://127.0.0.1:3002/api/revalidate";
const REVALIDATE_SECRET = process.env.SITE_REVALIDATE_SECRET || "";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function revalidate(slug?: string) {
  try {
    await fetch(REVALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, secret: REVALIDATE_SECRET }),
    });
  } catch {
    // Non-fatal — site will catch up on next ISR cycle
  }
}

const tool: ToolModule = {
  metadata: {
    id: "publish_article",
    displayName: "Article Publisher",
    category: "internal",
    description:
      "Publishes articles to strattegys.com. Creates MDX content files and database records. " +
      "Supports draft → publish workflow.",
    operations: ["create", "publish", "update", "unpublish", "list"],
    requiresApproval: true,
  },

  declaration: {
    name: "publish_article",
    description:
      "Manage articles on strattegys.com. " +
      "Commands: " +
      "create (arg1=title, arg2=slug [optional, auto-generated from title], arg3=content [MDX body], arg4=excerpt, arg5=author, arg6=tags [comma-separated], arg7=featureImage [url], arg8=seoTitle, arg9=seoDescription, arg10=contentItemId [optional]) — creates draft article, " +
      "publish (arg1=slug) — sets article live, " +
      "update (arg1=slug, arg2=field, arg3=value) — updates a field (title, excerpt, content, featured, spotlight, tags, featureImage, seoTitle, seoDescription), " +
      "unpublish (arg1=slug) — reverts to draft, " +
      "list (arg1=status [optional: draft|published|archived, defaults to all]).",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "Command: create, publish, update, unpublish, list",
        },
        arg1: { type: "string", description: "First arg (see command descriptions)" },
        arg2: { type: "string", description: "Second arg" },
        arg3: { type: "string", description: "Third arg" },
        arg4: { type: "string", description: "Fourth arg" },
        arg5: { type: "string", description: "Fifth arg" },
        arg6: { type: "string", description: "Sixth arg" },
        arg7: { type: "string", description: "Seventh arg" },
        arg8: { type: "string", description: "Eighth arg" },
        arg9: { type: "string", description: "Ninth arg" },
        arg10: { type: "string", description: "Tenth arg" },
      },
      required: ["command"],
    },
  },

  async execute(args) {
    const { query: dbQuery } = await import("../db");
    const cmd = args.command;

    // ─── create ───────────────────────────────────────────────────
    if (cmd === "create") {
      const title = args.arg1;
      if (!title) return "Error: arg1 (title) is required";

      const slug = args.arg2 || slugify(title);
      const content = args.arg3 || "";
      const excerpt = args.arg4 || null;
      const author = args.arg5 || null;
      const tags = args.arg6 ? args.arg6.split(",").map((t: string) => t.trim()) : [];
      const featureImage = args.arg7 || null;
      const seoTitle = args.arg8 || null;
      const seoDescription = args.arg9 || null;
      const contentItemId = args.arg10 || null;

      // Write MDX file
      await mkdir(CONTENT_PATH, { recursive: true });
      const filePath = path.join(CONTENT_PATH, `${slug}.mdx`);
      await writeFile(filePath, content, "utf-8");

      // Insert DB record
      await dbQuery(
        `INSERT INTO "_article" ("slug", "title", "excerpt", "author", "tags", "featureImage", "seoTitle", "seoDescription", "contentItemId", "status")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')`,
        [slug, title, excerpt, author, tags, featureImage, seoTitle, seoDescription, contentItemId]
      );

      return `Created draft article "${title}" (slug: ${slug}). MDX file written to ${filePath}. Use publish command to make it live.`;
    }

    // ─── publish ──────────────────────────────────────────────────
    if (cmd === "publish") {
      const slug = args.arg1;
      if (!slug) return "Error: arg1 (slug) is required";

      const rows = await dbQuery(
        `UPDATE "_article" SET "status" = 'published', "publishedAt" = NOW(), "updatedAt" = NOW()
         WHERE "slug" = $1 AND "deletedAt" IS NULL
         RETURNING "title"`,
        [slug]
      );
      if (rows.length === 0) return `Error: article with slug "${slug}" not found`;

      await revalidate(slug);
      return `Published "${(rows[0] as { title: string }).title}" — now live at /blog/${slug}`;
    }

    // ─── update ───────────────────────────────────────────────────
    if (cmd === "update") {
      const slug = args.arg1;
      const field = args.arg2;
      const value = args.arg3;
      if (!slug) return "Error: arg1 (slug) is required";
      if (!field) return "Error: arg2 (field) is required";

      if (field === "content") {
        // Update MDX file
        const filePath = path.join(CONTENT_PATH, `${slug}.mdx`);
        await writeFile(filePath, value || "", "utf-8");
        await dbQuery(
          `UPDATE "_article" SET "updatedAt" = NOW() WHERE "slug" = $1 AND "deletedAt" IS NULL`,
          [slug]
        );
        await revalidate(slug);
        return `Updated content for "${slug}"`;
      }

      const allowedFields = ["title", "subtitle", "excerpt", "featured", "spotlight", "tags", "featureImage", "seoTitle", "seoDescription", "author", "sortOrder"];
      if (!allowedFields.includes(field)) return `Error: field "${field}" is not updatable. Allowed: ${allowedFields.join(", ")}`;

      let sqlValue: unknown = value;
      if (field === "featured" || field === "spotlight") {
        sqlValue = value === "true";
      } else if (field === "tags") {
        sqlValue = value ? value.split(",").map((t: string) => t.trim()) : [];
      } else if (field === "sortOrder") {
        sqlValue = parseInt(value || "0");
      }

      await dbQuery(
        `UPDATE "_article" SET "${field}" = $1, "updatedAt" = NOW() WHERE "slug" = $2 AND "deletedAt" IS NULL`,
        [sqlValue, slug]
      );
      await revalidate(slug);
      return `Updated ${field} for "${slug}"`;
    }

    // ─── unpublish ────────────────────────────────────────────────
    if (cmd === "unpublish") {
      const slug = args.arg1;
      if (!slug) return "Error: arg1 (slug) is required";

      const rows = await dbQuery(
        `UPDATE "_article" SET "status" = 'draft', "updatedAt" = NOW()
         WHERE "slug" = $1 AND "deletedAt" IS NULL
         RETURNING "title"`,
        [slug]
      );
      if (rows.length === 0) return `Error: article with slug "${slug}" not found`;

      await revalidate(slug);
      return `Unpublished "${(rows[0] as { title: string }).title}" — reverted to draft`;
    }

    // ─── list ─────────────────────────────────────────────────────
    if (cmd === "list") {
      const statusFilter = args.arg1;
      let sql = `SELECT "slug", "title", "status", "publishedAt", "featured", "spotlight" FROM "_article" WHERE "deletedAt" IS NULL`;
      const params: unknown[] = [];

      if (statusFilter && ["draft", "published", "archived"].includes(statusFilter)) {
        sql += ` AND "status" = $1`;
        params.push(statusFilter);
      }

      sql += ` ORDER BY "updatedAt" DESC LIMIT 50`;
      const rows = await dbQuery(sql, params);

      if (rows.length === 0) return statusFilter ? `No ${statusFilter} articles found.` : "No articles found.";

      return rows
        .map((r: Record<string, unknown>) => {
          const flags = [];
          if (r.spotlight) flags.push("SPOTLIGHT");
          if (r.featured) flags.push("FEATURED");
          const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
          return `• ${r.title} (${r.slug}) — ${r.status}${flagStr}`;
        })
        .join("\n");
    }

    return `Unknown command: ${cmd}. Use: create, publish, update, unpublish, list`;
  },
};

export default tool;
