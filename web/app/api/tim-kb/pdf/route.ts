import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import {
  isMarniKbDatabaseConfigured,
  ensureTimPdfKbTopic,
  countKnowledgeChunksByTopic,
  splitKnowledgeText,
  insertAgentKnowledgeChunk,
  timPdfDocumentAlreadyIngested,
  touchKbTopicLastSync,
} from "@/lib/marni-kb";
import { extractTextFromPdfBuffer } from "@/lib/pdf-extract";
import { hasGeminiApiKey } from "@/lib/gemini-api-key";

export const runtime = "nodejs";

/** ~12 MiB — keep below typical proxy limits; raise only if your host allows. */
const MAX_BYTES = 12 * 1024 * 1024;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function noDb() {
  return NextResponse.json(
    { error: "CRM database not configured. Set CRM_DB_* and run migrate-marni-kb.sql." },
    { status: 503 }
  );
}

export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();
  if (!isMarniKbDatabaseConfigured()) return noDb();
  try {
    const topic = await ensureTimPdfKbTopic();
    const chunkCount = await countKnowledgeChunksByTopic(topic.id);
    return NextResponse.json({
      topic,
      chunkCount,
      geminiConfigured: hasGeminiApiKey(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  if (!isMarniKbDatabaseConfigured()) return noDb();
  if (!hasGeminiApiKey()) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is required to embed PDF text. Set it in web/.env.local." },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field "file"' }, { status: 400 });
  }

  const name = (file.name || "document.pdf").trim() || "document.pdf";
  if (!name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only .pdf files are accepted." }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf" && !file.type.includes("pdf")) {
    return NextResponse.json({ error: "File must be a PDF (application/pdf)." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `PDF too large (max ${Math.floor(MAX_BYTES / (1024 * 1024))} MB).` },
      { status: 413 }
    );
  }

  const sha256 = createHash("sha256").update(buf).digest("hex");

  let text: string;
  try {
    text = await extractTextFromPdfBuffer(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Could not read PDF: ${msg}` }, { status: 422 });
  }

  if (text.length < 40) {
    return NextResponse.json(
      {
        error:
          "Almost no extractable text in this PDF (it may be scanned images). OCR is not supported here yet.",
      },
      { status: 422 }
    );
  }

  try {
    const topic = await ensureTimPdfKbTopic();
    const topicId = topic.id;

    if (await timPdfDocumentAlreadyIngested(topicId, sha256)) {
      return NextResponse.json(
        { error: "This exact PDF file was already ingested for Tim.", sha256 },
        { status: 409 }
      );
    }

    const parts = splitKnowledgeText(text, 1100);
    let inserted = 0;
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i]!;
      const titleLine = `[PDF · Tim corpus] ${name}`;
      const body = `${titleLine}\n\n${chunk}`;
      await insertAgentKnowledgeChunk({
        agentId: "tim",
        topicId,
        content: body,
        metadata: {
          source: "pdf_upload",
          pdfSha256: sha256,
          fileName: name,
          chunkIndex: i,
          externalRef: `timPdf:${sha256}:chunk:${i}`,
        },
        embedPurpose: "tim_pdf_ingest",
      });
      inserted += 1;
    }

    await touchKbTopicLastSync(topicId);

    return NextResponse.json({
      ok: true,
      topicId,
      fileName: name,
      sha256,
      chunksInserted: inserted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
