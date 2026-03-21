"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import VoicePlayer from "./VoicePlayer";

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
  ttsVoice?: string;      // if set, show voice player for agent messages
  isLatest?: boolean;     // only auto-play TTS for the latest message
}

/** Convert a hex color to a dark, muted version suitable for a message background */
function toDarkBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Darken significantly and desaturate: blend toward dark grey
  const factor = 0.25;
  const dr = Math.round(r * factor * 0.7);
  const dg = Math.round(g * factor * 0.7);
  const db = Math.round(b * factor * 0.7);
  return `rgb(${dr}, ${dg}, ${db})`;
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
  ttsVoice,
  isLatest,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const isUser = role === "user";
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const agentBg = useMemo(() => toDarkBg(agentColor), [agentColor]);

  return (
    <div className="flex mb-1">
      <div
        className="relative group w-full"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          className="w-full rounded-lg px-3.5 py-2.5 break-words overflow-hidden text-[var(--text-primary)]"
          style={{
            background: isUser ? "var(--bg-tertiary)" : agentBg,
            border: isUser ? "1px solid rgba(74, 158, 202, 0.35)" : `1px solid ${agentColor}40`,
          }}
        >
          {replyTo && (
            <div className="text-[11px] mb-1.5 px-2 py-1 rounded border-l-2 bg-black/15 border-white/30 text-white/70">
              <div className="font-medium text-[10px] mb-0.5">
                {replyTo.role === "user" ? "You" : agentName}
              </div>
              <div className="truncate">{replyTo.text.slice(0, 100)}</div>
            </div>
          )}
          {isUser && (
            <div className="text-sm font-medium mb-1 text-[var(--text-secondary)]">
              {fromAgent
                ? fromAgent.charAt(0).toUpperCase() + fromAgent.slice(1)
                : "You"}
            </div>
          )}
          {!isUser && (
            <div className="text-sm font-medium mb-1" style={{ color: agentColor }}>
              {agentName}
              {delegatedFrom && (
                <span className="text-[var(--text-secondary)] font-normal">
                  {" "}(via {delegatedFrom.split(",").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")})
                </span>
              )}
            </div>
          )}
          <div className="text-[13px] leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-1 prose-code:text-xs prose-pre:bg-[var(--bg-primary)] prose-pre:rounded">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
          {!isUser && ttsVoice && text && (
            <VoicePlayer text={text} voice={ttsVoice} autoPlay={!!isLatest} />
          )}
          <div className="flex items-center justify-end gap-2 mt-1">
            {onReply && (
              <button
                onClick={onReply}
                className={`p-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}
                title="Reply"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9,17 4,12 9,7" />
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
              </button>
            )}
            <span className="text-[11px] text-[var(--text-tertiary)]">{time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
