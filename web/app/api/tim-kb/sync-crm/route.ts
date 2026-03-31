import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  isMarniKbDatabaseConfigured,
  ensureTimCrmMirrorKbTopic,
  countKnowledgeChunksByTopic,
} from "@/lib/marni-kb";
import { runTimCrmKnowledgeSync } from "@/lib/tim-crm-knowledge-sync";
import { isUnipileConfigured } from "@/lib/unipile-profile";
import { hasGeminiApiKey } from "@/lib/gemini-api-key";

export const runtime = "nodejs";

/** Unipile + many embeds — allow long runs on serverless hosts. */
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function noDb() {
  return NextResponse.json(
    { error: "CRM database not configured. Set CRM_DB_* and run migrate scripts (including migrate-kb-topic-kind.sql)." },
    { status: 503 }
  );
}

export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();
  if (!isMarniKbDatabaseConfigured()) return noDb();
  try {
    const topic = await ensureTimCrmMirrorKbTopic();
    const chunkCount = await countKnowledgeChunksByTopic(topic.id);
    return NextResponse.json({
      topic,
      chunkCount,
      unipileConfigured: isUnipileConfigured(),
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

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const chatLimit = Math.min(80, Math.max(1, Math.floor(Number(body.chatLimit) || 25)));
  const messagesPerChat = Math.min(100, Math.max(1, Math.floor(Number(body.messagesPerChat) || 40)));
  const includeNotes = body.includeNotes !== false;
  const dryRun = body.dryRun === true;
  const maxNewChunks = Math.min(
    5000,
    Math.max(1, Math.floor(Number(body.maxNewChunks) || 400))
  );
  const maxProfileLookups = Math.min(
    500,
    Math.max(0, Math.floor(Number(body.maxProfileLookups) || 80))
  );

  try {
    const result = await runTimCrmKnowledgeSync({
      chatLimit,
      messagesPerChat,
      includeNotes,
      dryRun,
      maxNewChunks,
      maxProfileLookups,
    });
    if (result.ok) return NextResponse.json(result);
    const errMsg =
      result.errors.find((e) => e.trim()) || "Sync could not start (check Unipile and CRM).";
    return NextResponse.json({ ...result, error: errMsg }, { status: 422 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, ok: false }, { status: 500 });
  }
}
