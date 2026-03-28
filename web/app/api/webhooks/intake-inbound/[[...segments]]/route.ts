import { NextResponse } from "next/server";
import {
  addIntake,
  extractFirstUrl,
  extractFirstUrlFromHtml,
  htmlToPlainText,
  intakeExistsWithMessageId,
} from "@/lib/intake";

const SECRET = process.env.INTAKE_INBOUND_WEBHOOK_SECRET?.trim() || "";

function getAllowlist(): string[] {
  const raw = process.env.INTAKE_INBOUND_ALLOWED_FROM?.trim() || "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Secret: query `?secret=`, header, Bearer, first path segment `/intake-inbound/<secret>` (Postmark-safe). */
function verifySecret(req: Request, pathSecret?: string): boolean {
  if (!SECRET) {
    console.warn("[intake-inbound] INTAKE_INBOUND_WEBHOOK_SECRET is unset — rejecting");
    return false;
  }
  if (pathSecret === SECRET) return true;
  const q = new URL(req.url).searchParams.get("secret");
  if (q === SECRET) return true;
  const h = req.headers.get("x-intake-inbound-secret");
  if (h === SECRET) return true;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${SECRET}`) return true;
  return false;
}

/** Parse `Name <email@x.com>` or bare email. */
function parseFromEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const addr = (m ? m[1] : from).trim().toLowerCase();
  const em = addr.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return em ? em[0] : addr;
}

function isAllowed(fromHeader: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    console.warn("[intake-inbound] INTAKE_INBOUND_ALLOWED_FROM is empty — rejecting");
    return false;
  }
  const email = parseFromEmail(fromHeader);
  return allowlist.includes(email);
}

type ParsedInbound = {
  from: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  messageId: string | null;
};

function parsePostmarkJson(body: Record<string, unknown>): ParsedInbound | null {
  const from = typeof body.From === "string" ? body.From : "";
  if (!from) return null;
  const subject = typeof body.Subject === "string" ? body.Subject : "(no subject)";
  const textBody =
    (typeof body.StrippedTextReply === "string" && body.StrippedTextReply.trim()
      ? body.StrippedTextReply
      : typeof body.TextBody === "string"
        ? body.TextBody
        : "") || "";
  const htmlBody = typeof body.HtmlBody === "string" ? body.HtmlBody : "";
  const messageId =
    typeof body.MessageID === "string"
      ? body.MessageID
      : typeof body.MessageId === "string"
        ? body.MessageId
        : null;
  return { from, subject, textBody, htmlBody, messageId };
}

async function parseRequest(req: Request): Promise<ParsedInbound | null> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    const from = String(form.get("From") || form.get("from") || "");
    if (!from) return null;
    const subject = String(form.get("Subject") || form.get("subject") || "(no subject)");
    const textBody = String(
      form.get("StrippedTextReply") ||
        form.get("stripped-text") ||
        form.get("TextBody") ||
        form.get("body-plain") ||
        form.get("text") ||
        ""
    );
    const htmlBody = String(form.get("HtmlBody") || form.get("body-html") || "");
    const messageId = String(form.get("Message-ID") || form.get("MessageID") || "") || null;
    return { from, subject, textBody, htmlBody, messageId };
  }

  if (ct.includes("application/json") || ct.includes("+json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      return parsePostmarkJson(body);
    } catch {
      return null;
    }
  }

  // Some senders use JSON bodies without a standard JSON Content-Type.
  try {
    const raw = await req.text();
    if (!raw.trim()) return null;
    const body = JSON.parse(raw) as Record<string, unknown>;
    return parsePostmarkJson(body);
  } catch {
    return null;
  }
}

type RouteCtx = { params: Promise<{ segments?: string[] }> };

function pathSecretFromParams(segments: string[] | undefined): string | undefined {
  if (!segments?.length) return undefined;
  return segments[0];
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { segments } = await ctx.params;
  const pathSecret = pathSecretFromParams(segments);
  if (!verifySecret(req, pathSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseRequest(req);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const allowlist = getAllowlist();
  if (!isAllowed(parsed.from, allowlist)) {
    console.warn("[intake-inbound] rejected From not in allowlist:", parsed.from.slice(0, 80));
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (parsed.messageId && (await intakeExistsWithMessageId(parsed.messageId))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const title = parsed.subject.trim().slice(0, 500) || "Email capture";
  const plainFromHtml = htmlToPlainText(parsed.htmlBody);
  const mergedPlain = parsed.textBody.trim() || plainFromHtml.trim();
  const bodyText = mergedPlain ? mergedPlain.slice(0, 20000) : null;
  const urlFromBody =
    extractFirstUrl(parsed.textBody) ||
    extractFirstUrlFromHtml(parsed.htmlBody) ||
    (mergedPlain ? extractFirstUrl(mergedPlain) : null);

  await addIntake("suzi", {
    title,
    url: urlFromBody,
    body: bodyText,
    source: "email",
    meta: {
      from: parsed.from,
      subject: parsed.subject,
      ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { segments } = await ctx.params;
  const pathSecret = pathSecretFromParams(segments);
  if (SECRET && pathSecret !== undefined && pathSecret !== SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allow = getAllowlist();
  return NextResponse.json({
    status: "ok",
    route: "intake-inbound",
    /** True when POSTs will be accepted (secret + at least one allowed From). */
    ready: Boolean(SECRET && allow.length > 0),
  });
}
