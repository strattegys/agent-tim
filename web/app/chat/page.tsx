"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import ChatWindow, { type Message } from "@/components/ChatWindow";
import ChatInput, { type ReplyContext } from "@/components/ChatInput";
import AgentSidebar from "@/components/AgentSidebar";
import AgentInfoPanel from "@/components/AgentInfoPanel";
import SystemPromptEditor from "@/components/SystemPromptEditor";

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
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyContext | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [lastSeenCounts, setLastSeenCounts] = useState<Record<string, number>>({});
  const loadedAgentRef = useRef<string | null>(null);

  const agent = AGENTS.find((a) => a.id === activeAgent) || AGENTS[0];

  // Filter messages by search query
  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => m.text.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  // Clear unread count when switching to an agent
  useEffect(() => {
    setUnreadCounts((prev) => ({ ...prev, [activeAgent]: 0 }));
    setLastSeenCounts((prev) => ({ ...prev, [activeAgent]: messages.length }));
  }, [activeAgent, messages.length]);

  // Poll for new messages from other agents (every 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      AGENTS.forEach((a) => {
        if (a.id === activeAgent) return;
        fetch(`/api/chat?agent=${a.id}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.history) {
              const total = data.history.length;
              const lastSeen = lastSeenCounts[a.id] || 0;
              const newMessages = Math.max(0, total - lastSeen);
              if (newMessages > 0) {
                setUnreadCounts((prev) => ({
                  ...prev,
                  [a.id]: (prev[a.id] || 0) + newMessages,
                }));
                setLastSeenCounts((prev) => ({ ...prev, [a.id]: total }));
              }
            }
          })
          .catch(() => {});
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [activeAgent, lastSeenCounts]);

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

  const handleReply = useCallback((msg: Message) => {
    setReplyTo({ id: msg.id, text: msg.text, role: msg.role });
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isLoading) return;

      const currentReply = replyTo;
      setReplyTo(null);

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
        timestamp: Date.now(),
        replyTo: currentReply ? { id: currentReply.id, text: currentReply.text, role: currentReply.role } : undefined,
      };

      const botMsgId = `bot-${Date.now()}`;

      // Prepend reply context for the API
      let apiMessage = text;
      if (currentReply) {
        const who = currentReply.role === "user" ? "my earlier message" : "your earlier message";
        apiMessage = `[Replying to ${who}: "${currentReply.text.slice(0, 200)}"]\n\n${text}`;
      }

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: apiMessage, agent: activeAgent }),
        });

        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({ error: "Request failed" }));
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "model",
              text: `Error: ${data.error || "Unknown error"}`,
              timestamp: Date.now(),
            },
          ]);
          return;
        }

        setMessages((prev) => [
          ...prev,
          { id: botMsgId, role: "model", text: "", timestamp: Date.now() },
        ]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMsgId ? { ...m, text: `Error: ${parsed.error}` } : m
                  )
                );
              } else if (parsed.text) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMsgId ? { ...m, text: m.text + parsed.text } : m
                  )
                );
              }
            } catch {
              // skip malformed chunks
            }
          }
        }

        try {
          const audio = new Audio("/sounds/notification.wav");
          audio.volume = 0.3;
          audio.play().catch(() => {});
        } catch {
          // ignore audio errors
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
    [isLoading, activeAgent, replyTo]
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <AgentSidebar
        agents={AGENTS}
        activeAgent={activeAgent}
        unreadCounts={unreadCounts}
        onSelect={(id) => {
          if (id !== activeAgent) {
            loadedAgentRef.current = null;
            setReplyTo(null);
            setActiveAgent(id);
          }
        }}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-primary)]">
        {/* Top bar */}
        <div className="h-11 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-medium truncate" style={{ color: agent.color }}>
              {agent.name}
            </span>
            <span className="text-xs text-[var(--text-secondary)] truncate hidden sm:inline">
              {agent.role}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {isSearching ? (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                autoFocus
                onBlur={() => {
                  if (!searchQuery) setIsSearching(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchQuery("");
                    setIsSearching(false);
                  }
                }}
                className="bg-[var(--bg-input)] text-[var(--text-primary)] text-xs rounded-lg px-2.5 py-1.5 w-40 outline-none placeholder-[var(--text-secondary)]"
              />
            ) : (
              <button
                onClick={() => setIsSearching(true)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
                title="Search messages"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowPromptEditor(true)}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
              title="Edit system prompt"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
          </div>
        </div>

        <ChatWindow
          messages={filteredMessages}
          isLoading={isLoading}
          agentName={agent.name}
          agentColor={agent.color}
          onReply={handleReply}
        />

        <ChatInput
          onSend={sendMessage}
          disabled={isLoading || !agent.online}
          placeholder={
            agent.online
              ? `Message ${agent.name}...`
              : `${agent.name} is offline`
          }
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          agentName={agent.name}
        />
      </div>

      {/* Info panel */}
      <AgentInfoPanel agent={agent} />

      {/* System Prompt Editor Modal */}
      {showPromptEditor && (
        <SystemPromptEditor
          agentId={activeAgent}
          agentName={agent.name}
          onClose={() => setShowPromptEditor(false)}
        />
      )}
    </div>
  );
}
