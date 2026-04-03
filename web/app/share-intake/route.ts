import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addIntake, extractFirstUrl } from "@/lib/intake";

/**
 * PWA Web Share Target (Android Chrome). Receives multipart POST with title, text, url.
 * Must be a public path in middleware so the POST body is not lost; we still require a session.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Sign in</title></head><body style="font-family:system-ui,sans-serif;padding:1.5rem;max-width:28rem;margin:auto;background:#0a0f18;color:#e2e4e8;">
<p>Open Command Central in this browser, sign in, then use <strong>Share</strong> again so the capture can be saved.</p>
<p><a href="/login" style="color:#5B8DEF">Go to login</a></p></body></html>`;
    return new NextResponse(html, {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  let title = "";
  let text = "";
  let url = "";

  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      title = String(form.get("title") || "").trim();
      text = String(form.get("text") || "").trim();
      url = String(form.get("url") || "").trim();
    }
  } catch {
    return NextResponse.json({ error: "Bad form data" }, { status: 400 });
  }

  const urlFromText = text ? extractFirstUrl(text) : null;
  const finalUrl = url || urlFromText || null;
  let finalTitle = title;
  if (!finalTitle) {
    if (finalUrl) {
      try {
        finalTitle = new URL(finalUrl).hostname.replace(/^www\./, "");
      } catch {
        finalTitle = "Shared link";
      }
    } else if (text) {
      finalTitle = text.split(/\n/)[0].trim().slice(0, 200) || "Shared note";
    } else {
      finalTitle = "Shared capture";
    }
  }

  const bodyOnly =
    text && finalUrl && text.includes(finalUrl)
      ? text.replace(finalUrl, "").trim()
      : text || null;

  await addIntake("suzi", {
    title: finalTitle.slice(0, 500),
    url: finalUrl,
    body: bodyOnly,
    source: "share",
  });

  const dest = new URL("/m/suzi?intakeLatest=1", req.url);
  return NextResponse.redirect(dest, 303);
}
