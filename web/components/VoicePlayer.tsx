"use client";

import { useState, useCallback } from "react";

interface VoicePlayerProps {
  text: string;
  autoPlay?: boolean;
  onPlayStart?: () => void;
  onPlayEnd?: () => void;
}

export default function VoicePlayer({
  text,
  autoPlay = true,
  onPlayStart,
  onPlayEnd,
}: VoicePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hasAutoPlayed, setHasAutoPlayed] = useState(false);

  const play = useCallback(async () => {
    if (isPlaying || isLoading || !text) return;

    setIsLoading(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        console.error("TTS failed:", res.status);
        return;
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onplay = () => {
        setIsPlaying(true);
        onPlayStart?.();
      };

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        onPlayEnd?.();
      };

      audio.onerror = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error("Playback error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [text, isPlaying, isLoading, onPlayStart, onPlayEnd]);

  // Auto-play on mount (once)
  if (autoPlay && !muted && !hasAutoPlayed && text) {
    setHasAutoPlayed(true);
    // Defer to avoid blocking render
    setTimeout(play, 100);
  }

  return (
    <div className="inline-flex items-center gap-1 mt-1">
      <button
        onClick={play}
        disabled={isPlaying || isLoading}
        className="text-[#6b8a9e] hover:text-[#7eb8e0] transition-colors disabled:opacity-50"
        title="Play voice"
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="6" height="16" rx="1" />
            <rect x="14" y="4" width="6" height="16" rx="1" />
          </svg>
        ) : isLoading ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="animate-spin"
          >
            <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>
      <button
        onClick={() => setMuted(!muted)}
        className="text-[#6b8a9e] hover:text-[#7eb8e0] transition-colors"
        title={muted ? "Unmute auto-play" : "Mute auto-play"}
      >
        {muted ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
    </div>
  );
}
