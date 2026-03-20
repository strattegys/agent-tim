import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";

// Resolve uploads dir at request time, not module load time
function getUploadsDir() {
  return process.env.AVATAR_DIR || path.join(process.cwd(), "uploads", "avatars");
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

    const uploadsDir = getUploadsDir();
    await mkdir(uploadsDir, { recursive: true });

    const ext = file.type === "image/svg+xml" ? "svg" : "png";
    const filename = `${safeId}-avatar.${ext}`;
    const filePath = path.join(uploadsDir, filename);

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
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const safeId = id.replace(/[^a-z0-9-]/gi, "");
    if (!safeId) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const uploadsDir = getUploadsDir();

    // Try png first, then svg
    for (const ext of ["png", "svg"]) {
      const filePath = path.join(uploadsDir, `${safeId}-avatar.${ext}`);
      try {
        const data = await readFile(filePath);
        const contentType = ext === "svg" ? "image/svg+xml" : "image/png";
        return new NextResponse(data, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      } catch {
        // file doesn't exist, try next ext
      }
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Failed to serve avatar" }, { status: 500 });
  }
}
