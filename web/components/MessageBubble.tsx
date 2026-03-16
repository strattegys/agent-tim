"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

interface MessageBubbleProps {
  role: "user" | "model";
  text: string;
  timestamp: number;
  agentName: string;
  agentColor: string;
  replyTo?: { id: string; text: string; role: "user" | "model" };
  onReply?: () => void;
}

export default function MessageBubble({
  role,
  text,
  timestamp,
  agentName,
  agentColor,
  replyTo,
  onReply,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const isUser = role === "user";
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1`}
    >
      <div
        className="relative group flex items-start gap-1"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Reply button — left side for user messages */}
        {isUser && onReply && (
          <button
            onClick={onReply}
            className={`shrink-0 self-center p-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-all ${hovered ? "opacity-100" : "opacity-0"} group-hover:opacity-100`}
            title="Reply"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9,17 4,12 9,7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
        )}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 break-words overflow-hidden ${
          isUser
            ? "bg-[var(--accent-green)] text-white rounded-br-sm"
            : "bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-bl-sm"
        }`}
      >
        {/* Reply context */}
        {replyTo && (
          <div className={`text-[11px] mb-1.5 px-2 py-1 rounded border-l-2 ${
            isUser
              ? "bg-white/10 border-white/40 text-white/70"
              : "bg-[var(--bg-primary)] border-[var(--accent-blue)] text-[var(--text-secondary)]"
          }`}>
            <div className="font-medium text-[10px] mb-0.5">
              {replyTo.role === "user" ? "You" : agentName}
            </div>
            <div className="truncate">{replyTo.text.slice(0, 100)}</div>
          </div>
        )}
        {!isUser && (
          <div
            className="text-xs font-medium mb-1"
            style={{ color: agentColor }}
          >
            {agentName}
          </div>
        )}
        <div className="text-[13px] leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-1 prose-code:text-xs prose-pre:bg-[var(--bg-primary)] prose-pre:rounded">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
        <div
          className={`text-[11px] mt-1 text-right ${
            isUser ? "text-white/60" : "text-[var(--text-tertiary)]"
          }`}
        >
          {time}
        </div>
      </div>

        {/* Reply button — right side for agent messages */}
        {!isUser && onReply && (
          <button
            onClick={onReply}
            className={`shrink-0 self-center p-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-all ${hovered ? "opacity-100" : "opacity-0"} group-hover:opacity-100`}
            title="Reply"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9,17 4,12 9,7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
