import { NextResponse } from "next/server";
import { textToSpeechStream, summarizeForVoice } from "@/lib/tts";

export async function POST(request: Request) {
  try {
    const { text, summarize } = await request.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
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

    // Stream mp3 audio from ElevenLabs directly to the client
    const audioStream = await textToSpeechStream(spokenText);

    return new Response(audioStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: unknown) {
    console.error("TTS error:", error);
    const msg = error instanceof Error ? error.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
