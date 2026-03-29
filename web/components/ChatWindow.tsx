"use client";

import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";

export interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
  replyTo?: { id: string; text: string; role: "user" | "model" };
  delegatedFrom?: string; // comma-separated agent IDs (e.g. "scout")
  fromAgent?: string;     // for inter-agent messages: who sent this
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  agentName: string;
  agentColor: string;
  onReply?: (msg: Message) => void;
}

export default function ChatWindow({
  messages,
  isLoading,
  agentName,
  agentColor,
  onReply,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    // On initial load or agent switch (message count jumps), scroll instantly
    // On new individual messages, scroll smoothly
    const isInitialLoad = prevCountRef.current === 0 && messages.length > 0;
    const isBigJump = Math.abs(messages.length - prevCountRef.current) > 2;
    const behavior = isInitialLoad || isBigJump ? "instant" : "smooth";

    bottomRef.current?.scrollIntoView({ behavior: behavior as ScrollBehavior });
    prevCountRef.current = messages.length;
  }, [messages, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden pl-2.5 pr-1.5 py-3 space-y-2.5">
      {messages.length === 0 && !isLoading && (
        <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
          Send a message to {agentName}
        </div>
      )}
      {messages.map((msg, idx) => {
        const isLast = idx === messages.length - 1;
        const thinkingInside =
          isLoading &&
          isLast &&
          msg.role === "model" &&
          !msg.text.trim();
        return (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            text={msg.text}
            timestamp={msg.timestamp}
            agentName={agentName}
            agentColor={agentColor}
            replyTo={msg.replyTo}
            onReply={onReply ? () => onReply(msg) : undefined}
            delegatedFrom={msg.delegatedFrom}
            fromAgent={msg.fromAgent}
            isThinking={thinkingInside}
          />
        );
      })}
      {/* Only before the empty model placeholder mounts (rare); in-flight replies use the agent bubble */}
      {isLoading &&
        (messages.length === 0 ||
          messages[messages.length - 1]?.role !== "model") && (
          <div className="flex justify-start mb-1">
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] bg-[color-mix(in_srgb,var(--bg-tertiary)_85%,var(--bg-primary))] px-4 py-3">
              <div className="flex space-x-1">
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50 animate-bounce [animation-delay:0ms]" />
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50 animate-bounce [animation-delay:150ms]" />
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      <div ref={bottomRef} />
    </div>
  );
}
