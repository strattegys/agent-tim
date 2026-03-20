"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useCallback, useEffect } from "react";

interface PushToTalkProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

function WaveformBars() {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-white"
          style={{
            animation: `waveform 1s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

const SILENCE_TIMEOUT_MS = 2000;

export default function PushToTalk({ onTranscript, disabled }: PushToTalkProps) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const SR =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SR) setSupported(false);
  }, []);

  const stop = useCallback(() => {
    clearSilenceTimer();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, [clearSilenceTimer]);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      stop();
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, stop]);

  const start = useCallback(() => {
    if (disabled) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      if (last.isFinal) {
        onTranscript(last[0].transcript.trim());
        resetSilenceTimer();
      }
    };

    recognition.onerror = () => {
      clearSilenceTimer();
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      clearSilenceTimer();
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    resetSilenceTimer();
  }, [onTranscript, disabled, resetSilenceTimer, clearSilenceTimer]);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  if (!supported) return null;

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`rounded-full flex items-center justify-center transition-all select-none shrink-0 ${
        isListening
          ? "w-16 h-10 bg-[var(--accent-blue)]"
          : "w-10 h-10 bg-[var(--accent-blue)] hover:brightness-125"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      title={isListening ? "Click to stop" : "Click to talk"}
    >
      {isListening ? (
        <WaveformBars />
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
    </button>
  );
}
