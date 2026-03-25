import { NextResponse } from "next/server";
import { synthesizeSpeech, summarizeForVoice } from "@/lib/tts";

export async function POST(request: Request) {
  try {
    const { text, summarize, voice } = await request.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    if (!process.env.INWORLD_TTS_KEY?.trim()) {
      return NextResponse.json(
        {
          error: "INWORLD_TTS_KEY is not set",
          hint: "Add the same INWORLD_TTS_KEY as Rainbow Bot (see PROJECT-SERVER/rainbow/avabot_server.py) to web/.env.local, then restart: docker compose -f docker-compose.dev.yml up -d --force-recreate",
        },
        { status: 503 }
      );
    }

    // Optionally summarize long text into a concise voice-friendly blurb
    let spokenText = text;
    if (summarize) {
      try {
        spokenText = await summarizeForVoice(text);
      } catch (err) {
        console.error("[tts] Summarization failed, using raw text:", err);
        // Fall back to first ~200 words if summarization fails
        spokenText = text.split(/\s+/).slice(0, 200).join(" ");
      }
    }
    console.log(`[tts] Speaking ${spokenText.split(/\s+/).length} words (summarized=${summarize})`);

    // Inworld WAV (same pipeline as Rainbow Bot).
    const { stream, contentType } = await synthesizeSpeech(
      spokenText,
      typeof voice === "string" ? voice : undefined
    );

    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error: unknown) {
    console.error("TTS error:", error);
    const msg = error instanceof Error ? error.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
