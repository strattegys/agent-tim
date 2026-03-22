import { GoogleGenAI } from "@google/genai";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

/**
 * Summarize a long response into a concise spoken blurb (uses Gemini text model).
 */
export async function summarizeForVoice(text: string): Promise<string> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are an AI assistant named Suzi. Rewrite the following response as a brief spoken summary (2-3 sentences max). Speak in first person as Suzi. Be natural and conversational — as if you're giving a quick verbal recap. Do NOT use phrases like "the speaker" or "the response says". Just say it directly.\n\nOriginal response:\n${text}`,
          },
        ],
      },
    ],
    config: {
      maxOutputTokens: 150,
      temperature: 0.7,
    },
  });

  return (
    response.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Here's a quick summary of what I said."
  );
}

/**
 * Stream TTS audio from ElevenLabs.
 * Returns a ReadableStream of mp3 chunks — pipe directly to the client response.
 */
export async function textToSpeechStream(text: string): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set");
  }

  const res = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}/stream`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`ElevenLabs API error ${res.status}: ${err}`);
  }

  if (!res.body) {
    throw new Error("No response body from ElevenLabs");
  }

  return res.body as ReadableStream<Uint8Array>;
}
