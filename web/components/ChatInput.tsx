"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import PushToTalk from "./PushToTalk";

export interface ReplyContext {
  id: string;
  text: string;
  role: "user" | "model";
}

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  onStop?: () => void;
  placeholder?: string;
  replyTo?: ReplyContext | null;
  onCancelReply?: () => void;
  agentName?: string;
  ttsSpeaking?: boolean;
  onStopTts?: () => void;
}

export default function ChatInput({
  onSend,
  disabled,
  isLoading,
  onStop,
  placeholder = "Type a message...",
  replyTo,
  onCancelReply,
  agentName,
  ttsSpeaking,
  onStopTts,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input when reply context is set
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

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
    if (e.key === "Escape" && replyTo && onCancelReply) {
      onCancelReply();
    }
  };

  const handleTranscript = useCallback(
    (transcript: string) => {
      if (transcript && !disabled) {
        setText((prev) => (prev ? prev + " " + transcript : transcript));
        inputRef.current?.focus();
      }
    },
    [disabled]
  );

  return (
    <div className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)]">
      {/* Reply context bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 pt-2 pb-1">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--border-color)_90%,transparent)] bg-[var(--bg-primary)]/70 px-3 py-1.5 text-xs text-[var(--text-chat-muted)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <polyline points="9,17 4,12 9,7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
            <span className="shrink-0 font-medium text-[var(--text-tertiary)]">
              {replyTo.role === "user" ? "You" : agentName || "Agent"}
            </span>
            <span className="truncate">{replyTo.text.slice(0, 80)}</span>
          </div>
          <button
            onClick={onCancelReply}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1"
            title="Cancel reply"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 px-4 py-3">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          className="max-h-[300px] flex-1 resize-none overflow-y-auto rounded-xl border border-[color-mix(in_srgb,var(--border-color)_55%,transparent)] bg-[color-mix(in_srgb,var(--bg-input)_92%,var(--bg-primary))] px-4 py-2.5 text-[13px] leading-snug text-[var(--text-chat-body)] outline-none placeholder:text-[var(--text-chat-muted)] disabled:opacity-50"
          style={{ minHeight: "80px" }}
        />
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          <PushToTalk onTranscript={handleTranscript} disabled={disabled} ttsSpeaking={ttsSpeaking} onStopTts={onStopTts} />
          {isLoading ? (
            <button
              onClick={onStop}
              className="w-10 h-10 rounded-full bg-[var(--accent-orange)] hover:brightness-110 flex items-center justify-center transition-all shrink-0 cursor-pointer"
              title="Stop response"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              className="w-10 h-10 rounded-full bg-[var(--accent-green)] hover:brightness-110 flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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
          )}
        </div>
      </div>
    </div>
  );
}
