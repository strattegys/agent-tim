import { NextResponse } from "next/server";
import { textToSpeech, summarizeForVoice } from "@/lib/tts";

export async function POST(request: Request) {
  try {
    const { text, voice, summarize } = await request.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    // Optionally summarize long text into a concise voice-friendly blurb
    const spokenText = summarize ? await summarizeForVoice(text) : text;

    const wavBuffer = await textToSpeech(spokenText, voice);

    return new NextResponse(new Uint8Array(wavBuffer), {
      headers: {
        "Content-Type": "audio/wav",
      },
    });
  } catch (error: unknown) {
    console.error("TTS error:", error);
    const msg = error instanceof Error ? error.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
