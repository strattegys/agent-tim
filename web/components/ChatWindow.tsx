"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TimContextDebugSnapshot } from "@/lib/tim-chat-debug";
import MessageBubble from "./MessageBubble";

export interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
  /** Heartbeat/autonomous model lines — shown in thread but not counted in sidebar unread. */
  ambient?: boolean;
  replyTo?: { id: string; text: string; role: "user" | "model" };
  delegatedFrom?: string; // comma-separated agent IDs (e.g. "scout")
  fromAgent?: string;     // for inter-agent messages: who sent this
  /** Tim only: server snapshot when `TIM_CHAT_CONTEXT_DEBUG=1` — work queue + UI context actually merged. */
  timContextDebug?: TimContextDebugSnapshot;
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  agentName: string;
  agentColor: string;
  onReply?: (msg: Message) => void;
}

function ChatThinkingPlaceholder() {
  return (
    <div className="flex justify-start mb-1">
      <div className="rounded-lg border border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] bg-[color-mix(in_srgb,var(--bg-tertiary)_85%,var(--bg-primary))] px-4 py-3">
        <div className="flex space-x-1">
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50 animate-bounce [animation-delay:0ms]" />
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50 animate-bounce [animation-delay:150ms]" />
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]/50 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

export default function ChatWindow({
  messages,
  isLoading,
  agentName,
  agentColor,
  onReply,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  /** Newest first in the UI; internal state and API stay chronological. */
  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    const isInitialLoad = prevCountRef.current === 0 && messages.length > 0;
    const isBigJump = Math.abs(messages.length - prevCountRef.current) > 2;
    const behavior = isInitialLoad || isBigJump ? "auto" : "smooth";

    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: 0, behavior: behavior as ScrollBehavior });
    }
    prevCountRef.current = messages.length;
  }, [messages, isLoading]);

  const showStandaloneThinking =
    isLoading &&
    (messages.length === 0 || messages[messages.length - 1]?.role !== "model");

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overflow-x-hidden pl-2.5 pr-1.5 py-3 space-y-2.5"
    >
      {messages.length === 0 && !isLoading && (
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-tertiary)]">
          Send a message to {agentName}
        </div>
      )}
      {showStandaloneThinking && ordered.length === 0 ? (
        <ChatThinkingPlaceholder />
      ) : null}
      {ordered.map((msg, idx) => {
        const isNewest = idx === 0;
        const thinkingInside =
          isLoading && isNewest && msg.role === "model" && !msg.text.trim();
        return (
          <div key={msg.id} className="contents">
            <MessageBubble
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
              timContextDebug={msg.timContextDebug}
            />
            {isNewest && showStandaloneThinking ? <ChatThinkingPlaceholder /> : null}
          </div>
        );
      })}
    </div>
  );
}
