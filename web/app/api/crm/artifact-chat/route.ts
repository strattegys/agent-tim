import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * Chat with an agent to refine an artifact's content.
 * POST { artifactId, message, currentContent, agentId? }
 * Returns { reply, updatedContent? }
 *
 * Uses Groq (GROQ_CHAT_MODEL or openai/gpt-oss-120b) for the completion.
 */
export async function POST(req: NextRequest) {
  try {
    const { artifactId, message, currentContent, agentId } = await req.json();

    if (!message || !currentContent) {
      return NextResponse.json({ error: "message and currentContent required" }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ reply: "Agent is not configured (missing GROQ_API_KEY)." }, { status: 200 });
    }

    const agentName = agentId === "ghost" ? "Ghost" : agentId === "marni" ? "Marni" : agentId || "Ghost";

    const systemPrompt = `You are ${agentName}, a content strategist assistant. The user is reviewing a document and wants changes.

CURRENT DOCUMENT:
---
${currentContent}
---

The user will ask you to make specific changes to this document. Your job is to:
1. Understand what they want changed
2. Make the changes to the document
3. Respond with a brief confirmation of what you changed

IMPORTANT: You MUST return your response in this exact JSON format:
{"reply": "Brief description of what you changed", "updatedContent": "The full updated document content"}

If the user is asking a question rather than requesting changes, respond with just:
{"reply": "Your answer here"}

Keep the document in markdown format. Preserve all existing structure unless asked to change it.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:
          process.env.GROQ_CHAT_MODEL?.trim() || "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[artifact-chat] Groq error:", errText);
      return NextResponse.json({ reply: `${agentName} couldn't process that request. Try again.` });
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";

    let parsed: { reply?: string; updatedContent?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { reply: text };
    }

    // If we got updated content, save it to the database
    if (parsed.updatedContent && artifactId) {
      await query(
        `UPDATE "_artifact" SET content = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [parsed.updatedContent, artifactId]
      );
    }

    return NextResponse.json({
      reply: parsed.reply || "Done.",
      updatedContent: parsed.updatedContent || undefined,
    });
  } catch (error) {
    console.error("[artifact-chat] error:", error);
    return NextResponse.json({ reply: "Something went wrong. Try again." });
  }
}
