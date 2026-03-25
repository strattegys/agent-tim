/**
 * Client-side TTS queue with streaming playback.
 *
 * - Accumulates streamed text from the chat
 * - On flush: fires a single TTS request (with optional summarization)
 * - Plays Inworld WAV from /api/tts
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

      if (this.aborted) {
        this.onStateChange("idle");
        return;
      }

      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        let detail = "";
        try {
          if (ct.includes("application/json")) {
            const j = (await res.json()) as { error?: string; hint?: string };
            detail = [j.error, j.hint].filter(Boolean).join(" — ");
          } else {
            detail = (await res.text()).slice(0, 300);
          }
        } catch {
          detail = `HTTP ${res.status}`;
        }
        console.error("[TTS] /api/tts failed:", res.status, detail || res.statusText);
        this.onStateChange("idle");
        return;
      }

      const blob = await res.blob();
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
      audio.play().catch((e) => {
        console.warn(
          "[TTS] audio.play() failed (often autoplay policy — click the page once, then send another message):",
          e
        );
        this.currentAudio = null;
        URL.revokeObjectURL(url);
        resolve();
      });
    });
  }
}
