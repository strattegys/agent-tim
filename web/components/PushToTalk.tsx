"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useCallback, useEffect } from "react";

interface PushToTalkProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  ttsSpeaking?: boolean;
  onStopTts?: () => void;
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

const SILENCE_TIMEOUT_MS = 5000;

export default function PushToTalk({ onTranscript, disabled, ttsSpeaking, onStopTts }: PushToTalkProps) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True until user clicks stop or silence timeout — used to survive Chrome's onend after each utterance. */
  const listeningIntentRef = useRef(false);
  const noSpeechRetriesRef = useRef(0);

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
    listeningIntentRef.current = false;
    noSpeechRetriesRef.current = 0;
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

    listeningIntentRef.current = true;
    noSpeechRetriesRef.current = 0;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    const tryRestart = () => {
      if (!listeningIntentRef.current || !recognitionRef.current) return;
      try {
        recognitionRef.current.start();
      } catch {
        listeningIntentRef.current = false;
        recognitionRef.current = null;
        setIsListening(false);
      }
    };

    recognition.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      if (last.isFinal) {
        noSpeechRetriesRef.current = 0;
        onTranscript(last[0].transcript.trim());
        resetSilenceTimer();
      }
    };

    recognition.onerror = (e: any) => {
      const code = e?.error as string | undefined;
      if (code === "aborted") return;
      if ((code === "no-speech" || code === "audio-capture") && listeningIntentRef.current) {
        noSpeechRetriesRef.current += 1;
        if (noSpeechRetriesRef.current > 12) {
          listeningIntentRef.current = false;
          clearSilenceTimer();
          setIsListening(false);
          recognitionRef.current = null;
          return;
        }
        window.setTimeout(tryRestart, 100);
        return;
      }
      if (code === "not-allowed") {
        listeningIntentRef.current = false;
        setSupported(false);
      }
      clearSilenceTimer();
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      if (!listeningIntentRef.current) {
        clearSilenceTimer();
        recognitionRef.current = null;
        setIsListening(false);
        return;
      }
      // Chromium ends the session after many final results; restart while the user still has the mic "on".
      clearSilenceTimer();
      window.setTimeout(tryRestart, 0);
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch {
      listeningIntentRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
    }
  }, [onTranscript, disabled, resetSilenceTimer, clearSilenceTimer]);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  if (!supported) return null;

  // When TTS is speaking, show a stop button instead of the mic
  if (ttsSpeaking) {
    return (
      <button
        onClick={onStopTts}
        className="w-9 h-9 rounded-full flex items-center justify-center transition-all select-none shrink-0 bg-red-500 hover:bg-red-600 cursor-pointer animate-pulse"
        title="Stop speaking"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="text-white"
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`rounded-full flex items-center justify-center transition-all select-none shrink-0 ${
        isListening
          ? "w-14 h-9 bg-[var(--accent-blue)]"
          : "w-9 h-9 bg-[var(--accent-blue)] hover:brightness-125"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      title={isListening ? "Click to stop" : "Click to talk"}
    >
      {isListening ? (
        <WaveformBars />
      ) : (
        <svg
          width="16"
          height="16"
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
