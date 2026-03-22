/**
 * Client-side TTS queue with streaming playback.
 *
 * - Accumulates streamed text from the chat
 * - On flush: fires a single TTS request (with optional summarization)
 * - Plays audio as mp3 chunks arrive (no waiting for full file)
 * - Exposes stop() and state change callbacks
 */

const LONG_THRESHOLD_WORDS = 100;

export type TtsState = "idle" | "loading" | "speaking";

export interface TtsQueueOptions {
  voice: string;
  onStateChange?: (state: TtsState) => void;
}

export class TtsQueue {
  private voice: string;
  private buffer = "";
  private aborted = false;
  private currentAudio: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;
  private onStateChange: (state: TtsState) => void;

  constructor(opts: TtsQueueOptions) {
    this.voice = opts.voice;
    this.onStateChange = opts.onStateChange ?? (() => {});
  }

  /** Feed streaming text chunks. */
  push(chunk: string) {
    this.buffer += chunk;
  }

  /** Streaming done — fire TTS. */
  async flush() {
    if (this.aborted) return;

    const text = this.buffer.trim();
    this.buffer = "";
    if (!text) return;

    const wordCount = text.split(/\s+/).length;
    const summarize = wordCount > LONG_THRESHOLD_WORDS;

    this.onStateChange("loading");

    try {
      this.abortController = new AbortController();

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: this.voice, summarize }),
        signal: this.abortController.signal,
      });

      if (this.aborted || !res.ok || !res.body) {
        this.onStateChange("idle");
        return;
      }

      // Create a blob URL from the streaming response and play immediately.
      // The browser will start decoding/playing mp3 as data arrives.
      const blob = await this.streamToBlob(res.body);
      if (this.aborted) {
        this.onStateChange("idle");
        return;
      }

      await this.playBlob(blob);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // expected from stop()
      }
    }

    if (!this.aborted) {
      this.onStateChange("idle");
    }
  }

  /** Stop playback and cancel any pending request. */
  stop() {
    this.aborted = true;
    this.buffer = "";
    this.abortController?.abort();
    this.abortController = null;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    this.onStateChange("idle");
  }

  /**
   * Stream response body into a Blob.
   * We collect chunks and create a blob — the Audio element can start
   * decoding mp3 from the blob URL immediately (mp3 is streamable).
   */
  private async streamToBlob(body: ReadableStream<Uint8Array>): Promise<Blob> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      if (this.aborted) {
        reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return new Blob(chunks, { type: "audio/mpeg" });
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      if (this.aborted) { resolve(); return; }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;

      this.onStateChange("speaking");

      audio.onended = () => {
        this.currentAudio = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        this.currentAudio = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.play().catch(() => {
        this.currentAudio = null;
        URL.revokeObjectURL(url);
        resolve();
      });
    });
  }
}
