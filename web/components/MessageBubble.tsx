"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { TimContextDebugSnapshot } from "@/lib/tim-chat-debug";

interface MessageBubbleProps {
  role: "user" | "model";
  text: string;
  timestamp: number;
  agentName: string;
  agentColor: string;
  replyTo?: { id: string; text: string; role: "user" | "model" };
  onReply?: () => void;
  delegatedFrom?: string; // comma-separated agent IDs
  fromAgent?: string;     // inter-agent: who sent this user message
  /** Agent bubble: show typing dots inside the same styled box (no empty shell + separate loader). */
  isThinking?: boolean;
  /** Tim: optional server snapshot of merged work-queue + UI context (debug). */
  timContextDebug?: TimContextDebugSnapshot;
}

/** Subtle agent tint on top of app tertiary bg — low contrast, not a saturated slab. */
function toMutedAgentBubbleBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const br = 24;
  const bg = 37;
  const bb = 51;
  const mix = 0.11;
  return `rgb(${Math.round(br + (r - br) * mix)}, ${Math.round(bg + (g - bg) * mix)}, ${Math.round(bb + (b - bb) * mix)})`;
}

export default function MessageBubble({
  role,
  text,
  timestamp,
  agentName,
  agentColor,
  replyTo,
  onReply,
  delegatedFrom,
  fromAgent,
  isThinking,
  timContextDebug,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const isUser = role === "user";
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const agentBg = useMemo(() => toMutedAgentBubbleBg(agentColor), [agentColor]);

  return (
    <div className="flex mb-1">
      <div
        className="relative group w-full"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          className="w-full rounded-lg px-3.5 py-2.5 break-words overflow-hidden"
          style={{
            background: isUser ? "color-mix(in srgb, var(--bg-tertiary) 92%, var(--bg-primary))" : agentBg,
            border: isUser
              ? "1px solid color-mix(in srgb, var(--border-color) 75%, transparent)"
              : `1px solid color-mix(in srgb, ${agentColor} 14%, var(--border-color))`,
          }}
        >
          {replyTo && (
            <div className="text-[11px] mb-1.5 px-2 py-1 rounded border-l-2 border-l-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[var(--bg-primary)]/50 text-[var(--text-chat-muted)]">
              <div className="font-medium text-[10px] mb-0.5 text-[var(--text-tertiary)]">
                {replyTo.role === "user" ? "You" : agentName}
              </div>
              <div className="truncate text-[var(--text-chat-body)]">{replyTo.text.slice(0, 100)}</div>
            </div>
          )}
          {isUser && (
            <div className="mb-1 text-[12px] font-medium text-[var(--text-tertiary)]">
              {fromAgent
                ? fromAgent.charAt(0).toUpperCase() + fromAgent.slice(1)
                : "You"}
            </div>
          )}
          {!isUser && (
            <div className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">
              {agentName}
              {delegatedFrom && (
                <span className="text-[var(--text-tertiary)] font-normal">
                  {" "}(via {delegatedFrom.split(",").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")})
                </span>
              )}
            </div>
          )}
          {!isUser && timContextDebug && (
            <details className="mb-2 rounded border border-amber-500/35 bg-amber-950/25 text-left">
              <summary className="cursor-pointer select-none px-2 py-1.5 text-[10px] font-medium text-amber-200/90">
                Context debug (this turn)
              </summary>
              <div className="space-y-2 border-t border-amber-500/20 px-2 py-2 text-[10px] leading-snug text-amber-100/85">
                <p className="text-[var(--text-secondary)]">{timContextDebug.summaryLine}</p>
                <div>
                  <div className="mb-0.5 font-semibold text-amber-200/80">Tim work-queue string</div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/35 p-2 font-mono text-[9px] text-[var(--text-chat-body)]">
                    {timContextDebug.timWorkContext || "(empty)"}
                  </pre>
                </div>
                {timContextDebug.uiContext ? (
                  <div>
                    <div className="mb-0.5 font-semibold text-amber-200/80">UI context</div>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-black/35 p-2 font-mono text-[9px] text-[var(--text-chat-body)]">
                      {timContextDebug.uiContext}
                    </pre>
                  </div>
                ) : null}
              </div>
            </details>
          )}
          {isThinking ? (
            <div className="flex items-center gap-1.5 py-1" aria-label="Thinking">
              <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms] bg-[var(--text-tertiary)]/55" />
              <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:150ms] bg-[var(--text-tertiary)]/55" />
              <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:300ms] bg-[var(--text-tertiary)]/55" />
            </div>
          ) : (
            <div className="message-markdown">
              <ReactMarkdown>{text}</ReactMarkdown>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-1">
            {onReply && !isThinking && (
              <button
                onClick={onReply}
                className={`p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}
                title="Reply"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9,17 4,12 9,7" />
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
              </button>
            )}
            {!isThinking && (
              <span className="text-[11px] text-[var(--text-chat-muted)] tabular-nums">{time}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
