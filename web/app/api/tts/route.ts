import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { textToSpeech, isLongReply, summarizeForVoice } from "@/lib/tts";

export async function POST(request: Request) {
  // Auth check - allow unauthenticated for now (no Google OAuth configured)
  // const session = await auth();
  // if (!session?.user?.email) {
  //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // }

  try {
    const { text } = await request.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    let spokenText = text;
    let summarized = false;

    if (isLongReply(text)) {
      spokenText = await summarizeForVoice(text);
      summarized = true;
    }

    const wavBuffer = await textToSpeech(spokenText);

    return new NextResponse(new Uint8Array(wavBuffer), {
      headers: {
        "Content-Type": "audio/wav",
        "X-Summarized": summarized ? "true" : "false",
        "X-Spoken-Text": encodeURIComponent(spokenText),
      },
    });
  } catch (error: unknown) {
    console.error("TTS error:", error);
    const msg = error instanceof Error ? error.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
