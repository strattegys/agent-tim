"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import ChatWindow, { type Message } from "@/components/ChatWindow";
import ChatInput from "@/components/ChatInput";
import AgentSidebar from "@/components/AgentSidebar";
import AgentInfoPanel from "@/components/AgentInfoPanel";

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  color: string;
  avatar?: string;
  online: boolean;
  capabilities: string[];
  connections: { label: string; connected: boolean }[];
}

const AGENTS: AgentConfig[] = [
  {
    id: "tim",
    name: "Tim",
    role: "Marketing & Sales Assistant",
    color: "#1D9E75",
    avatar: "/tim-avatar.png?v=2",
    online: true,
    capabilities: ["LinkedIn DMs", "CRM search", "Follow-ups", "Campaigns"],
    connections: [
      { label: "CRM", connected: true },
      { label: "LinkedIn", connected: true },
      { label: "Web search", connected: true },
    ],
  },
  {
    id: "rainbow",
    name: "Rainbow",
    role: "Abby's Magical AI Friend",
    color: "#534AB7",
    avatar: "/rainbow-avatar.png",
    online: true,
    capabilities: ["Stories", "Learning", "Games", "Creativity"],
    connections: [{ label: "Web search", connected: true }],
  },
  {
    id: "suzi",
    name: "Suzi",
    role: "Personal Assistant",
    color: "#D85A30",
    avatar: "/suzi-avatar.png",
    online: true,
    capabilities: ["Web search", "Summaries", "Relay messages", "Message Susan"],
    connections: [{ label: "Web search", connected: true }, { label: "Telegram", connected: true }],
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState("tim");
  const loadedAgentRef = useRef<string | null>(null);

  const agent = AGENTS.find((a) => a.id === activeAgent) || AGENTS[0];

  // Load chat history when agent changes
  useEffect(() => {
    if (loadedAgentRef.current === activeAgent) return;
    loadedAgentRef.current = activeAgent;

    fetch(`/api/chat?agent=${activeAgent}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.history && data.history.length > 0) {
          setMessages(
            data.history.map(
              (msg: { role: string; text: string; timestamp: number }, i: number) => ({
                id: `history-${activeAgent}-${i}`,
                role: msg.role as "user" | "model",
                text: msg.text,
                timestamp: msg.timestamp,
              })
            )
          );
        } else {
          setMessages([]);
        }
      })
      .catch(() => setMessages([]));
  }, [activeAgent]);

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

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, agent: activeAgent }),
        });

        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        const data = await res.json();

        if (data.error) {
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "model",
              text: `Error: ${data.error}`,
              timestamp: Date.now(),
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `bot-${Date.now()}`,
              role: "model",
              text: data.reply,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "model",
            text: "Failed to connect. Please try again.",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, activeAgent]
  );

  return (
    <div className="flex flex-col items-center justify-center h-screen p-4">
      <div className="flex items-center gap-3 mb-4" style={{ maxWidth: 900, width: "100%" }}>
        <span className="text-base font-semibold text-[var(--text-primary)] tracking-tight">
          Strattegys Command Central
        </span>
      </div>
      <div
        className="flex w-full rounded-xl overflow-hidden border border-[var(--border-color)]"
        style={{ maxWidth: 900, height: "min(700px, 85vh)" }}
      >
        {/* Sidebar */}
        <AgentSidebar
          agents={AGENTS}
          activeAgent={activeAgent}
          onSelect={(id) => {
            if (id !== activeAgent) {
              loadedAgentRef.current = null;
              setActiveAgent(id);
            }
          }}
        />

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-primary)]">
          {/* Top bar */}
          <div className="h-11 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]" />

          <ChatWindow
            messages={messages}
            isLoading={isLoading}
            agentName={agent.name}
            agentColor={agent.color}
          />

          <ChatInput
            onSend={sendMessage}
            disabled={isLoading || !agent.online}
            placeholder={
              agent.online
                ? `Message ${agent.name}...`
                : `${agent.name} is offline`
            }
          />
        </div>

        {/* Info panel */}
        <AgentInfoPanel agent={agent} />
      </div>
    </div>
  );
}
