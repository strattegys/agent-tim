"use client";

import ReactMarkdown from "react-markdown";

interface MessageBubbleProps {
  role: "user" | "model";
  text: string;
  timestamp: number;
}

export default function MessageBubble({
  role,
  text,
  timestamp,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 ${
          isUser
            ? "bg-[#2b5278] text-[#f5f5f5]"
            : "bg-[#182533] text-[#f5f5f5]"
        }`}
      >
        <div className="text-[13px] leading-[1.4] prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-1 prose-code:text-[12px] prose-pre:bg-[#0e1621] prose-pre:rounded">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
        <div
          className={`text-[11px] mt-1 ${
            isUser ? "text-[#7eb8e0]" : "text-[#6b8a9e]"
          } text-right`}
        >
          {time}
        </div>
      </div>
    </div>
  );
}
