import { GoogleGenAI } from "@google/genai";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

/**
 * Summarize a long response into a concise spoken blurb using Gemini Flash.
 */
export async function summarizeForVoice(text: string): Promise<string> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are Suzi, an AI assistant. Summarize this response as a brief spoken recap (3-5 sentences). Rules:
- Speak in first person as Suzi
- Cover ALL key points, not just the greeting
- Be natural and conversational, like you're giving a verbal update to your boss
- Do NOT use phrases like "the speaker" or "the response says"
- Do NOT output just a greeting — lead with substance
- Strip out markdown formatting, bullet points, and lists — convert to flowing speech

Response to summarize:
${text}`,
  });

  const result = response.text;
  if (result) {
    return result;
  }
  return "Here's a quick summary of what I said.";
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
