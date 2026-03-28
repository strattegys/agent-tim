import { GoogleGenAI } from "@google/genai";

const TTS_VOICE = "Kore";
const WORD_THRESHOLD = 75; // ~30 seconds of speech at 150 wpm

function getClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

/** Convert PCM L16 24kHz mono to WAV */
function pcmToWav(pcmData: Buffer): Buffer {
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

export function isLongReply(text: string): boolean {
  const wordCount = text.split(/\s+/).length;
  return wordCount > WORD_THRESHOLD;
}

export async function summarizeForVoice(text: string): Promise<string> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Summarize the following response in 1-2 short sentences for a voice readout. Keep it natural and conversational:\n\n${text}`,
          },
        ],
      },
    ],
    config: {
      maxOutputTokens: 100,
      temperature: 0.5,
    },
  });

  return (
    response.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Here's what I found."
  );
}

export async function textToSpeech(text: string): Promise<Buffer> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-tts",
    contents: [
      {
        role: "user",
        parts: [{ text: `Say the following: ${text}` }],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: TTS_VOICE,
          },
        },
      },
    },
  });

  const audioPart = response.candidates?.[0]?.content?.parts?.[0];
  if (!audioPart?.inlineData?.data) {
    throw new Error("No audio data in TTS response");
  }

  const pcmBuffer = Buffer.from(audioPart.inlineData.data, "base64");
  return pcmToWav(pcmBuffer);
}
