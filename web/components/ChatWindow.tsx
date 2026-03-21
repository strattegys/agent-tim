"use client";

import { useEffect, useRef, useMemo } from "react";
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
  ttsVoice?: string;
}

export default function ChatWindow({
  messages,
  isLoading,
  agentName,
  agentColor,
  onReply,
  ttsVoice,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Find the last model message ID for TTS auto-play
  const lastModelMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "model") return messages[i].id;
    }
    return null;
  }, [messages]);

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
        <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
          Send a message to {agentName}
        </div>
      )}
      {messages.map((msg) => (
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
          ttsVoice={ttsVoice}
          isLatest={msg.id === lastModelMsgId && !msg.id.startsWith("history-")}
        />
      ))}
      {isLoading && (
        <div className="flex justify-start mb-1">
          <div className="bg-[var(--bg-tertiary)] rounded-lg px-4 py-3">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-[var(--text-secondary)] rounded-full animate-bounce [animation-delay:0ms]" />
              <div className="w-2 h-2 bg-[var(--text-secondary)] rounded-full animate-bounce [animation-delay:150ms]" />
              <div className="w-2 h-2 bg-[var(--text-secondary)] rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
