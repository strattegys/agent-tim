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
}

export default function ChatWindow({ messages, isLoading }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
      {messages.length === 0 && !isLoading && (
        <div className="flex items-center justify-center h-full text-[#6b8a9e] text-[13px]">
          Send a message or hold the mic to talk to Tim
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          role={msg.role}
          text={msg.text}
          timestamp={msg.timestamp}
        />
      ))}
      {isLoading && (
        <div className="flex justify-start mb-1">
          <div className="bg-[#182533] rounded-lg px-4 py-3">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-[#6b8a9e] rounded-full animate-bounce [animation-delay:0ms]" />
              <div className="w-2 h-2 bg-[#6b8a9e] rounded-full animate-bounce [animation-delay:150ms]" />
              <div className="w-2 h-2 bg-[#6b8a9e] rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
