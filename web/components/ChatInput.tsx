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
          <div className="flex-1 flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded-lg px-3 py-1.5 border-l-2 border-[var(--accent-blue)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <polyline points="9,17 4,12 9,7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
            <span className="font-medium shrink-0">
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
          rows={1}
          className="flex-1 bg-[var(--bg-input)] text-[var(--text-primary)] text-sm rounded-2xl px-4 py-2.5 resize-none outline-none placeholder-[var(--text-secondary)] disabled:opacity-50 max-h-[120px] overflow-y-auto"
          style={{ minHeight: "40px" }}
        />
        <PushToTalk onTranscript={handleTranscript} disabled={disabled} />
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
  );
}
