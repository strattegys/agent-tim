/**
 * Client-side TTS queue.
 *
 * - Accumulates streamed text
 * - On flush: if short, TTS the full text; if long, ask server to summarize first
 * - Plays audio and signals state changes via onStateChange callback
 * - stop() cancels any in-flight request and halts playback
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
  private onStateChange: (state: TtsState) => void;

  constructor(opts: TtsQueueOptions) {
    this.voice = opts.voice;
    this.onStateChange = opts.onStateChange ?? (() => {});
  }

  /** Feed streaming text chunks. */
  push(chunk: string) {
    this.buffer += chunk;
  }

  /** Streaming done — fire TTS (with optional summarization for long text). */
  async flush() {
    if (this.aborted) return;

    const text = this.buffer.trim();
    this.buffer = "";
    if (!text) return;

    const wordCount = text.split(/\s+/).length;
    const summarize = wordCount > LONG_THRESHOLD_WORDS;

    this.onStateChange("loading");

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: this.voice, summarize }),
      });

      if (this.aborted || !res.ok) {
        this.onStateChange("idle");
        return;
      }

      const blob = await res.blob();
      if (this.aborted) {
        this.onStateChange("idle");
        return;
      }

      await this.playBlob(blob);
    } catch {
      // network error or aborted
    }

    if (!this.aborted) {
      this.onStateChange("idle");
    }
  }

  /** Stop playback and cancel any pending request. */
  stop() {
    this.aborted = true;
    this.buffer = "";
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.onStateChange("idle");
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
