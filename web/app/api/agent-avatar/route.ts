import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { getAgentSpec } from "@/lib/agent-registry";

export const runtime = "nodejs";

/**
 * Persistent avatar uploads.
 * - Production Docker: AVATAR_DIR=/data/agent-avatars (see root docker-compose.yml).
 * - Dev Docker: same via docker-compose.dev.yml + ./docker-data/agent-avatars on the host.
 * - Native `npm run dev` from web/: defaults to ../docker-data/agent-avatars (repo root), unless
 *   running inside a container without AVATAR_DIR (use /tmp — set AVATAR_DIR in compose).
 */
function resolveAvatarDir(): string {
  if (process.env.AVATAR_DIR?.trim()) {
    return process.env.AVATAR_DIR.trim();
  }
  if (process.env.NODE_ENV === "production") {
    return "/tmp/agent-avatars";
  }
  if (existsSync("/.dockerenv")) {
    return "/tmp/agent-avatars";
  }
  return path.join(process.cwd(), "..", "docker-data", "agent-avatars");
}

const AVATAR_DIR = resolveAvatarDir();

function safeHexColor(c: string | undefined, fallback: string): string {
  if (c && /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(c)) return c;
  return fallback;
}

function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Always image/svg+xml so <img src> never receives JSON (avoids broken-image icon). */
function fallbackSvgResponse(initialChar: string, fill: string): NextResponse {
  const ch = escapeSvgText((initialChar || "?").slice(0, 1));
  const color = safeHexColor(fill, "#555555");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="64" ry="64" fill="${color}"/>
      <text x="64" y="64" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="56" font-weight="600" fill="white">${ch}</text>
    </svg>`;
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const agentId = formData.get("agentId") as string | null;

    if (!file || !agentId) {
      return NextResponse.json({ error: "Missing file or agentId" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 25MB" }, { status: 400 });
    }

    const safeId = agentId.replace(/[^a-z0-9-]/gi, "");
    if (!safeId) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }

    await mkdir(AVATAR_DIR, { recursive: true });

    const ext = file.type === "image/svg+xml" ? "svg" : "png";
    const filename = `${safeId}-avatar.${ext}`;
    const filePath = path.join(AVATAR_DIR, filename);

    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    const avatarUrl = `/api/agent-avatar?id=${safeId}&v=${Date.now()}`;
    return NextResponse.json({ avatarUrl });
  } catch (err) {
    console.error("Avatar upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  let safeId = "";
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return fallbackSvgResponse("?", "#6b7280");
    }

    safeId = id.replace(/[^a-z0-9-]/gi, "");
    if (!safeId) {
      return fallbackSvgResponse("?", "#6b7280");
    }

    // Check the one persistent avatar directory, then fall back to public/
    const searchDirs = [AVATAR_DIR, path.join(process.cwd(), "public")];

    for (const dir of searchDirs) {
      for (const ext of ["png", "svg"]) {
        const filePath = path.join(dir, `${safeId}-avatar.${ext}`);
        try {
          const data = await readFile(filePath);
          const contentType =
            ext === "svg" ? "image/svg+xml; charset=utf-8" : "image/png";
          return new NextResponse(data, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "no-store",
            },
          });
        } catch {
          // file doesn't exist, try next
        }
      }
    }

    const spec = getAgentSpec(safeId);
    const color = safeHexColor(spec.color, "#555555");
    const initial = spec.name?.[0] || safeId[0]?.toUpperCase() || "?";
    return fallbackSvgResponse(initial, color);
  } catch (err) {
    console.error("agent-avatar GET:", err);
    try {
      const spec = safeId ? getAgentSpec(safeId) : getAgentSpec("tim");
      return fallbackSvgResponse(
        spec.name?.[0] || safeId[0] || "?",
        spec.color
      );
    } catch {
      return fallbackSvgResponse("?", "#555555");
    }
  }
}
