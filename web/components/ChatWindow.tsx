"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TimContextDebugSnapshot } from "@/lib/tim-chat-debug";
import MessageBubble, { toMutedAgentBubbleBg } from "./MessageBubble";

export interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
  /** Heartbeat/autonomous model lines — shown in thread but not counted in sidebar unread. */
  ambient?: boolean;
  replyTo?: { id: string; text: string; role: "user" | "model" };
  delegatedFrom?: string; // comma-separated agent IDs (e.g. "scout")
  fromAgent?: string; // for inter-agent messages: who sent this
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

/** Thinking state shown in the streaming placeholder bubble (empty model message). */
function thinkingShownInsideBubble(messages: Message[], isLoading: boolean): boolean {
  if (!isLoading || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  return last.role === "model" && !last.text.trim();
}

function AgentThinkingStrip({ agentName, agentColor }: { agentName: string; agentColor: string }) {
  const agentBg = useMemo(() => toMutedAgentBubbleBg(agentColor), [agentColor]);
  return (
    <div className="flex justify-start shrink-0 px-2 pt-1.5 pb-1" aria-live="polite">
      <div
        className="w-full max-w-[min(100%,25.2rem)] rounded-md px-3 py-2"
        style={{
          background: agentBg,
          border: `1px solid color-mix(in srgb, ${agentColor} 14%, var(--border-color))`,
        }}
      >
        <div className="mb-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{agentName}</div>
        <div className="flex items-center gap-1.5 py-0.5" aria-label="Thinking">
          <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms] bg-[var(--text-tertiary)]/55" />
          <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:150ms] bg-[var(--text-tertiary)]/55" />
          <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:300ms] bg-[var(--text-tertiary)]/55" />
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

  const inBubbleThinking = thinkingShownInsideBubble(messages, isLoading);
  const showThinkingStrip = isLoading && !inBubbleThinking;

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {showThinkingStrip ? (
        <AgentThinkingStrip agentName={agentName} agentColor={agentColor} />
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pl-2 pr-1 py-2.5 space-y-2"
      >
        {messages.length === 0 && !isLoading && (
          <div className="flex h-full min-h-[108px] items-center justify-center text-[12px] text-[var(--text-tertiary)]">
            Send a message to {agentName}
          </div>
        )}
        {ordered.map((msg, idx) => {
          const isNewest = idx === 0;
          const thinkingInside =
            isLoading && isNewest && msg.role === "model" && !msg.text.trim();
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
              timContextDebug={msg.timContextDebug}
            />
          );
        })}
      </div>
    </div>
  );
}
