"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface VoicePlayerProps {
  text: string;
  voice?: string;
  autoPlay?: boolean;
  onPlayStart?: () => void;
  onPlayEnd?: () => void;
}

export default function VoicePlayer({
  text,
  voice,
  autoPlay = false,
  onPlayStart,
  onPlayEnd,
}: VoicePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasAutoPlayed = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  const play = useCallback(async () => {
    // Stop any existing playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const currentText = textRef.current;
    if (!currentText) return;

    setIsLoading(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: currentText, voice }),
      });

      if (!res.ok) {
        console.error("TTS failed:", res.status);
        return;
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setIsPlaying(true);
        onPlayStart?.();
      };

      audio.onended = () => {
        setIsPlaying(false);
        audioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        onPlayEnd?.();
      };

      audio.onerror = () => {
        setIsPlaying(false);
        audioRef.current = null;
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error("Playback error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [voice, onPlayStart, onPlayEnd]);

  // Auto-play once when autoPlay becomes true (streaming just finished)
  useEffect(() => {
    if (autoPlay && !hasAutoPlayed.current && text) {
      hasAutoPlayed.current = true;
      play();
    }
  }, [autoPlay, text, play]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

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
    </div>
  );
}
