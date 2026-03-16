"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useCallback, useEffect } from "react";

interface PushToTalkProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export default function PushToTalk({ onTranscript, disabled }: PushToTalkProps) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SR =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SR) setSupported(false);
  }, []);

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
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [onTranscript, disabled]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

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
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-all select-none shrink-0 ${
        isListening
          ? "bg-red-500 animate-pulse scale-110"
          : "bg-[var(--accent-blue)] hover:brightness-125"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      title={isListening ? "Click to stop" : "Click to talk"}
    >
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
    </button>
  );
}
