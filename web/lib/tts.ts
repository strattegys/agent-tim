import { GoogleGenAI } from "@google/genai";

/** Same base URL as Rainbow Bot (`avabot_server.py`). */
const INWORLD_TTS_API = "https://api.inworld.ai/tts/v1/voice";

export type TtsSynthesisResult = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
};

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
 * Inworld TTS — same contract as Rainbow Bot `handle_tts` in
 * PROJECT-SERVER/rainbow/avabot_server.py:
 * - POST `voice:stream`
 * - modelId `inworld-tts-1.5-mini`
 * - LINEAR16 @ 22050
 * - NDJSON lines with `result.audioContent` base64 WAV chunks; strip RIFF headers and merge PCM into one WAV.
 */
async function inworldTextToWavBuffer(text: string, voiceIdOverride?: string): Promise<Buffer> {
  const apiKey = process.env.INWORLD_TTS_KEY?.trim();
  if (!apiKey) {
    throw new Error("INWORLD_TTS_KEY must be set (same as Rainbow Bot INWORLD_TTS_KEY in avabot_server.py)");
  }

  const voiceId =
    voiceIdOverride?.trim() || process.env.INWORLD_VOICE_ID?.trim() || "Kelsey";
  const sampleRate = 22050;

  const res = await fetch(`${INWORLD_TTS_API}:stream`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voiceId,
      modelId: "inworld-tts-1.5-mini",
      audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: sampleRate,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Inworld TTS error ${res.status}: ${err.slice(0, 500)}`);
  }

  const raw = Buffer.from(await res.arrayBuffer());
  const pcmParts: Buffer[] = [];
  const textRaw = raw.toString("utf-8");

  for (const line of textRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const chunk = JSON.parse(trimmed) as {
        result?: { audioContent?: string };
      };
      const audioB64 = chunk?.result?.audioContent;
      if (!audioB64) continue;
      const wavBytes = Buffer.from(audioB64, "base64");
      if (wavBytes.length >= 4 && wavBytes.subarray(0, 4).equals(Buffer.from("RIFF"))) {
        pcmParts.push(wavBytes.subarray(44));
      } else {
        pcmParts.push(wavBytes);
      }
    } catch {
      continue;
    }
  }

  const pcmData = Buffer.concat(pcmParts);
  if (pcmData.length === 0) {
    throw new Error("No audio data received from Inworld (empty stream parse)");
  }

  return pcmToWav(pcmData, sampleRate);
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * @param voiceHint — Inworld `voiceId` from agent registry (e.g. Olivia for Suzi)
 */
export async function synthesizeSpeech(
  text: string,
  voiceHint?: string
): Promise<TtsSynthesisResult> {
  const wav = await inworldTextToWavBuffer(text, voiceHint);
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(wav));
        controller.close();
      },
    }),
    contentType: "audio/wav",
  };
}
