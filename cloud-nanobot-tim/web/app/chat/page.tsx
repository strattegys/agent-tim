"use client";

import { useState, useCallback } from "react";
import ChatWindow, { type Message } from "@/components/ChatWindow";
import ChatInput from "@/components/ChatInput";
import VoicePlayer from "@/components/VoicePlayer";

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [latestReply, setLatestReply] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isLoading) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setLatestReply(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        const data = await res.json();

        if (data.error) {
          const errorMsg: Message = {
            id: `error-${Date.now()}`,
            role: "model",
            text: `Error: ${data.error}`,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        } else {
          const botMsg: Message = {
            id: `bot-${Date.now()}`,
            role: "model",
            text: data.reply,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, botMsg]);
          setLatestReply(data.reply);
        }
      } catch {
        const errorMsg: Message = {
          id: `error-${Date.now()}`,
          role: "model",
          text: "Failed to connect. Please try again.",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading]
  );

  return (
    <div className="h-screen flex flex-col bg-[#0e1621]">
      {/* Header */}
      <div className="bg-[#17212b] border-b border-[#1f2f3d] px-4 py-2.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[#2b5278] flex items-center justify-center">
          <span className="text-sm font-bold text-white">T</span>
        </div>
        <div>
          <div className="text-[14px] font-medium text-[#f5f5f5]">Tim</div>
          <div className="text-[11px] text-[#6b8a9e]">
            {isLoading ? "typing..." : "online"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <ChatWindow messages={messages} isLoading={isLoading} />

      {/* Voice player for latest reply */}
      {latestReply && (
        <div className="hidden">
          <VoicePlayer text={latestReply} autoPlay />
        </div>
      )}

      {/* Input */}
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
