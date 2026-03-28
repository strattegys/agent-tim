"use client";

import { useState, useRef, useCallback } from "react";
import PushToTalk from "./PushToTalk";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTranscript = useCallback(
    (transcript: string) => {
      if (transcript && !disabled) {
        onSend(transcript);
      }
    },
    [onSend, disabled]
  );

  return (
    <div className="border-t border-[#1f2f3d] bg-[#17212b] px-3 py-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Tim..."
          disabled={disabled}
          rows={1}
          className="flex-1 bg-[#242f3d] text-[#f5f5f5] text-[13px] rounded-lg px-3 py-2 resize-none outline-none placeholder-[#6b8a9e] disabled:opacity-50 max-h-[120px] overflow-y-auto"
          style={{ minHeight: "36px" }}
        />
        <PushToTalk onTranscript={handleTranscript} disabled={disabled} />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="w-10 h-10 rounded-full bg-[#2b5278] hover:bg-[#3a6a96] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Send"
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
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22,2 15,22 11,13 2,9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
