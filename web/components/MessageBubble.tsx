"use client";

import ReactMarkdown from "react-markdown";

interface MessageBubbleProps {
  role: "user" | "model";
  text: string;
  timestamp: number;
  agentName: string;
  agentColor: string;
}

export default function MessageBubble({
  role,
  text,
  timestamp,
  agentName,
  agentColor,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 break-words overflow-hidden ${
          isUser
            ? "bg-[var(--accent-green)] text-white rounded-br-sm"
            : "bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-bl-sm"
        }`}
      >
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
    </div>
  );
}
