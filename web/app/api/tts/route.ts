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
    const spokenText = summarize ? await summarizeForVoice(text) : text;

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
