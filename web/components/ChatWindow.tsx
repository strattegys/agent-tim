"use client";

import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";

export interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  agentName: string;
  agentColor: string;
}

export default function ChatWindow({
  messages,
  isLoading,
  agentName,
  agentColor,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-1">
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
