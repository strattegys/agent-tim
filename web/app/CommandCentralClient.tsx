"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import ChatWindow, { type Message } from "@/components/ChatWindow";
import ChatInput, { type ReplyContext } from "@/components/ChatInput";
import AgentSidebar from "@/components/AgentSidebar";
import AgentInfoPanel from "@/components/AgentInfoPanel";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import FridayDashboardPanel from "@/components/friday/FridayDashboardPanel";
import PennyDashboardPanel from "@/components/penny/PennyDashboardPanel";
import TimAgentPanel from "@/components/tim/TimAgentPanel";
import GhostAgentPanel from "@/components/ghost/GhostAgentPanel";
import SuziRemindersPanel from "@/components/suzi/SuziRemindersPanel";
import MarniWorkPanel, { type MarniWorkPanelTab } from "@/components/marni/MarniWorkPanel";
import KingCostPanel from "@/components/king/KingCostPanel";
import StatusRail from "@/components/StatusRail";
import { AgentPanelPrinciples } from "@/components/AgentPanelPrinciples";

import AgentAvatar from "@/components/AgentAvatar";
import { SIDEBAR_HEADER_TITLE } from "@/lib/app-brand";
import { agentHasUserWorkItem } from "@/lib/agent-work-badges";
import { WorkBellIcon } from "@/components/icons/WorkBellIcon";
import { getFrontendAgents, agentHasKanban, type AgentConfig, AGENT_CATEGORIES } from "@/lib/agent-frontend";
import { panelBus } from "@/lib/events";
import { TtsQueue, type TtsState } from "@/lib/tts-queue";
import { compressAvatarImage } from "@/lib/compress-avatar-image";
import {
  formatTimWorkQueueContext,
  type TimWorkQueueSelection,
} from "@/lib/tim-work-context";
import {
  formatGhostWorkQueueContext,
  type GhostWorkQueueSelection,
} from "@/lib/ghost-work-context";
import {
  formatSuziWorkPanelContext,
  type SuziFocusedIntake,
  type SuziFocusedPunchList,
  type SuziFocusedReminder,
  type SuziFocusedNote,
  type SuziWorkSubTab,
} from "@/lib/suzi-work-panel";
import {
  formatAgentUiContext,
  type FridayDashboardTab,
  type PennyDashboardTab,
} from "@/lib/agent-ui-context";
import type { DashboardNotification, DashboardSyncResponse } from "@/lib/dashboard-sync-types";
import Link from "next/link";

const SUZI_INTAKE_FOCUS_STORAGE = "suzi_intake_focus_v1";
const SUZI_PUNCH_FOCUS_STORAGE = "suzi_punch_focus_v1";
const SUZI_REMINDER_FOCUS_STORAGE = "suzi_reminder_focus_v1";
const SUZI_NOTE_FOCUS_STORAGE = "suzi_note_focus_v1";

/** Other agents’ sidebar line — lower priority than the active streamed thread. */
const CROSS_AGENT_CHAT_MS_VISIBLE = 90_000;
const CROSS_AGENT_CHAT_MS_HIDDEN = 300_000;

const AGENTS: AgentConfig[] = getFrontendAgents();

type RightPanel =
  | "info"
  | "kanban"
  | "dashboard"
  | "reminders"
  | "notes"
  | "tasks"
  | "messages"
  | "costs"
  | "marni-work";

const VALID_RIGHT_PANELS: RightPanel[] = [
  "info",
  "kanban",
  "dashboard",
  "reminders",
  "notes",
  "tasks",
  "messages",
  "costs",
  "marni-work",
];

export default function CommandCentralClient() {
  const searchParams = useSearchParams();
  const paramAgent = searchParams.get("agent");
  const paramPanel = searchParams.get("panel");

  // Each agent's default panel when selected
  function defaultPanelFor(agentId: string): RightPanel {
    if (agentId === "friday") return "dashboard";
    if (agentId === "penny") return "dashboard";
    if (agentId === "suzi") return "reminders";
    if (agentId === "tim") return "messages";
    if (agentId === "ghost") return "messages";
    if (agentId === "king") return "costs";
    if (agentId === "marni") return "marni-work";
    if (agentHasKanban(agentId)) return "kanban";
    return "info";
  }

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState(paramAgent || "suzi");
  const [rightPanel, setRightPanel] = useState<RightPanel>(() => {
    const agent = paramAgent || "suzi";
    const p = paramPanel as RightPanel | null;
    if (agent === "friday" && p === "tasks") return "dashboard";
    if (agent === "tim" && p === "kanban") return "messages";
    if (agent === "ghost" && p === "kanban") return "messages";
    if (agent === "marni" && (p === "kanban" || paramPanel === "knowledge")) return "marni-work";
    return p || defaultPanelFor(agent);
  });

  // Deep links (e.g. Friday → ?agent=tim&panel=messages): searchParams update but state
  // was only initialized on mount — sync when the URL changes.
  useEffect(() => {
    if (paramAgent && AGENTS.some((a) => a.id === paramAgent)) {
      setActiveAgent(paramAgent);
    }
    if (paramAgent === "marni" && (paramPanel === "kanban" || paramPanel === "knowledge")) {
      setRightPanel("marni-work");
      return;
    }
    if (paramPanel && VALID_RIGHT_PANELS.includes(paramPanel as RightPanel)) {
      if (paramAgent === "friday" && paramPanel === "tasks") {
        setRightPanel("dashboard");
      } else if (paramAgent === "tim" && paramPanel === "kanban") {
        setRightPanel("messages");
      } else if (paramAgent === "ghost" && paramPanel === "kanban") {
        setRightPanel("messages");
      } else {
        setRightPanel(paramPanel as RightPanel);
      }
    }
  }, [paramAgent, paramPanel]);

  useEffect(() => {
    setRightPanel((prev) =>
      prev === "messages" && activeAgent !== "tim" && activeAgent !== "ghost"
        ? defaultPanelFor(activeAgent)
        : prev
    );
  }, [activeAgent]);

  useEffect(() => {
    setRightPanel((prev) => {
      if (activeAgent !== "tim" && activeAgent !== "ghost") return prev;
      if (prev === "info" || prev === "kanban") return "messages";
      return prev;
    });
  }, [activeAgent]);

  useEffect(() => {
    if (rightPanel !== "kanban") return;
    if (activeAgent === "tim" || activeAgent === "ghost") setRightPanel("messages");
  }, [activeAgent, rightPanel]);

  useEffect(() => {
    if (rightPanel === "costs" && activeAgent !== "king") {
      setRightPanel(defaultPanelFor(activeAgent));
    }
    // defaultPanelFor is stable logic for agent id → panel; listing it causes redundant runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgent, rightPanel]);

  useEffect(() => {
    if (rightPanel === "marni-work" && activeAgent !== "marni") {
      setRightPanel(defaultPanelFor(activeAgent));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgent, rightPanel]);

  useEffect(() => {
    if (activeAgent === "marni" && rightPanel === "kanban") {
      setRightPanel("marni-work");
    }
  }, [activeAgent, rightPanel]);

  useEffect(() => {
    if (activeAgent !== "marni") setMarniWorkSubTab("queue");
  }, [activeAgent]);

  useEffect(() => {
    setRightPanel((prev) =>
      activeAgent === "friday" && prev === "tasks" ? "dashboard" : prev
    );
  }, [activeAgent]);

  /** After Tim intake / approve, surface the work queue if the user was on agent info. */
  useEffect(() => {
    return panelBus.on("tim_human_task_progress", () => {
      if (activeAgentRef.current !== "tim") return;
      setRightPanel((p) => (p === "info" || p === "kanban" ? "messages" : p));
    });
  }, []);

  const [dashboardTabVisible, setDashboardTabVisible] = useState(() =>
    typeof document !== "undefined" ? document.visibilityState === "visible" : true
  );
  useEffect(() => {
    const onVis = () => setDashboardTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  const [testingTaskCount, setTestingTaskCount] = useState(0);
  const [timMessagingTaskCount, setTimMessagingTaskCount] = useState(0);
  const [timPendingQueueCount, setTimPendingQueueCount] = useState(0);
  const [ghostContentTaskCount, setGhostContentTaskCount] = useState(0);
  const [dashboardNotifications, setDashboardNotifications] = useState<DashboardNotification[]>([]);

  const applyDashboardSync = useCallback((data: DashboardSyncResponse) => {
    if (!data?.badges) return;
    const b = data.badges;
    setPendingTaskCount(b.pendingTaskCount);
    setTestingTaskCount(b.testingTaskCount);
    setTimMessagingTaskCount(b.timMessagingTaskCount);
    setTimPendingQueueCount(b.timPendingQueueCount);
    setGhostContentTaskCount(b.ghostContentTaskCount);
    setDashboardNotifications(Array.isArray(data.notifications) ? data.notifications : []);
  }, []);

  const refreshDashboardSync = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard-sync", { credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as DashboardSyncResponse;
      applyDashboardSync(data);
    } catch {
      /* ignore */
    }
  }, [applyDashboardSync]);

  useEffect(() => {
    return panelBus.on("dashboard_sync", () => {
      void refreshDashboardSync();
    });
  }, [refreshDashboardSync]);

  /** Live badge + notification updates via SSE while the tab is visible. */
  useEffect(() => {
    if (typeof window === "undefined" || !dashboardTabVisible) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let backoffMs = 1500;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/dashboard-stream");
      es.onopen = () => {
        backoffMs = 1500;
      };
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as DashboardSyncResponse;
          applyDashboardSync(data);
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          backoffMs = Math.min(Math.round(backoffMs * 1.6), 30_000);
          connect();
        }, backoffMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [dashboardTabVisible, applyDashboardSync]);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [sidebarView, setSidebarView] = useState<"agents" | "toys">("agents");

  const [timWorkSelection, setTimWorkSelection] = useState<TimWorkQueueSelection | null>(null);
  const [ghostWorkSelection, setGhostWorkSelection] = useState<GhostWorkQueueSelection | null>(null);
  const [suziWorkSubTab, setSuziWorkSubTab] = useState<SuziWorkSubTab>("intake");
  const [suziFocusedIntake, setSuziFocusedIntake] = useState<SuziFocusedIntake | null>(null);
  const [suziFocusedPunchList, setSuziFocusedPunchList] = useState<SuziFocusedPunchList | null>(null);
  const [suziFocusedReminder, setSuziFocusedReminder] = useState<SuziFocusedReminder | null>(null);
  const [suziFocusedNote, setSuziFocusedNote] = useState<SuziFocusedNote | null>(null);
  const [fridayDashboardTab, setFridayDashboardTab] =
    useState<FridayDashboardTab>("packages");
  const [pennyDashboardTab, setPennyDashboardTab] =
    useState<PennyDashboardTab>("packages");
  const [marniWorkSubTab, setMarniWorkSubTab] = useState<MarniWorkPanelTab>("queue");
  const onMarniWorkTabChange = useCallback((t: MarniWorkPanelTab) => {
    setMarniWorkSubTab(t);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyContext | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [lastSeenCounts, setLastSeenCounts] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("chat_last_seen_counts");
        return stored ? JSON.parse(stored) : {};
      } catch { return {}; }
    }
    return {};
  });
  const [lastMessages, setLastMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUZI_INTAKE_FOCUS_STORAGE);
      if (!raw) return;
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (typeof p.id !== "string" || typeof p.title !== "string") return;
      setSuziFocusedIntake({
        id: p.id,
        title: p.title,
        url: typeof p.url === "string" ? p.url : null,
        body: typeof p.body === "string" ? p.body : null,
        source: typeof p.source === "string" ? p.source : "ui",
        displayNumber: typeof p.displayNumber === "number" ? p.displayNumber : undefined,
        filterQuery: typeof p.filterQuery === "string" && p.filterQuery.trim() ? p.filterQuery.trim() : undefined,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (suziFocusedIntake?.id) {
        localStorage.setItem(SUZI_INTAKE_FOCUS_STORAGE, JSON.stringify(suziFocusedIntake));
      } else {
        localStorage.removeItem(SUZI_INTAKE_FOCUS_STORAGE);
      }
    } catch {
      /* ignore */
    }
  }, [suziFocusedIntake]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUZI_PUNCH_FOCUS_STORAGE);
      if (!raw) return;
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (typeof p.id !== "string" || typeof p.itemNumber !== "number" || typeof p.title !== "string") return;
      setSuziFocusedPunchList({
        id: p.id,
        itemNumber: p.itemNumber,
        title: p.title,
        description: typeof p.description === "string" ? p.description : null,
        category: typeof p.category === "string" ? p.category : null,
        rank: typeof p.rank === "number" ? p.rank : 1,
        columnLabel: typeof p.columnLabel === "string" ? p.columnLabel : "Now",
        status: p.status === "done" ? "done" : "open",
        notes: Array.isArray(p.notes)
          ? (p.notes as unknown[])
              .filter(
                (n): n is { id: string; content: string; createdAt: string } =>
                  typeof n === "object" &&
                  n !== null &&
                  typeof (n as { id?: string }).id === "string" &&
                  typeof (n as { content?: string }).content === "string" &&
                  typeof (n as { createdAt?: string }).createdAt === "string"
              )
              .map((n) => ({ id: n.id, content: n.content, createdAt: n.createdAt }))
          : [],
        actions: Array.isArray(p.actions)
          ? (p.actions as unknown[])
              .filter(
                (a): a is { id: string; content: string; done: boolean } =>
                  typeof a === "object" &&
                  a !== null &&
                  typeof (a as { id?: string }).id === "string" &&
                  typeof (a as { content?: string }).content === "string" &&
                  typeof (a as { done?: boolean }).done === "boolean"
              )
              .map((a) => ({ id: a.id, content: a.content, done: a.done }))
          : [],
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (suziFocusedPunchList?.id) {
        localStorage.setItem(SUZI_PUNCH_FOCUS_STORAGE, JSON.stringify(suziFocusedPunchList));
      } else {
        localStorage.removeItem(SUZI_PUNCH_FOCUS_STORAGE);
      }
    } catch {
      /* ignore */
    }
  }, [suziFocusedPunchList]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUZI_REMINDER_FOCUS_STORAGE);
      if (!raw) return;
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (typeof p.id !== "string" || typeof p.title !== "string") return;
      setSuziFocusedReminder({
        id: p.id,
        title: p.title,
        description: typeof p.description === "string" ? p.description : null,
        category: typeof p.category === "string" ? p.category : "one-time",
        nextDueAt: typeof p.nextDueAt === "string" ? p.nextDueAt : null,
        recurrence: typeof p.recurrence === "string" ? p.recurrence : null,
        isActive: typeof p.isActive === "boolean" ? p.isActive : true,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (suziFocusedReminder?.id) {
        localStorage.setItem(
          SUZI_REMINDER_FOCUS_STORAGE,
          JSON.stringify(suziFocusedReminder)
        );
      } else {
        localStorage.removeItem(SUZI_REMINDER_FOCUS_STORAGE);
      }
    } catch {
      /* ignore */
    }
  }, [suziFocusedReminder]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUZI_NOTE_FOCUS_STORAGE);
      if (!raw) return;
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof p.id !== "string" ||
        typeof p.title !== "string" ||
        typeof p.noteNumber !== "number"
      )
        return;
      setSuziFocusedNote({
        id: p.id,
        noteNumber: p.noteNumber,
        title: p.title,
        content: typeof p.content === "string" ? p.content : null,
        tag: typeof p.tag === "string" ? p.tag : null,
        pinned: typeof p.pinned === "boolean" ? p.pinned : false,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (suziFocusedNote?.id) {
        localStorage.setItem(SUZI_NOTE_FOCUS_STORAGE, JSON.stringify(suziFocusedNote));
      } else {
        localStorage.removeItem(SUZI_NOTE_FOCUS_STORAGE);
      }
    } catch {
      /* ignore */
    }
  }, [suziFocusedNote]);

  const syncChatSidebarAfterTurn = useCallback((agentId: string) => {
    fetch(`/api/chat?agent=${encodeURIComponent(agentId)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.history?.length) return;
        const total = data.history.length;
        const lastMsg = data.history[data.history.length - 1] as { text?: string };
        const preview = lastMsg.text;
        if (typeof preview === "string") {
          setLastMessages((prev) => ({ ...prev, [agentId]: preview }));
        }
        setLastSeenCounts((prev) => {
          const updated = { ...prev, [agentId]: total };
          try {
            localStorage.setItem("chat_last_seen_counts", JSON.stringify(updated));
          } catch {
            /* ignore */
          }
          return updated;
        });
        setUnreadCounts((prev) => ({ ...prev, [agentId]: 0 }));
      })
      .catch(() => {});
  }, []);

  const [avatarOverrides, setAvatarOverrides] = useState<Record<string, string>>({});
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  /** Inworld voiceId from server (per-agent registry only — no global env fallback to avoid wrong voice). */
  const [effectiveTtsVoice, setEffectiveTtsVoice] = useState<string | null>(null);
  const ttsQueueRef = useRef<TtsQueue | null>(null);
  const loadedAgentRef = useRef<string | null>(null);
  const activeAgentRef = useRef(activeAgent);
  activeAgentRef.current = activeAgent;
  const abortRef = useRef<AbortController | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const agents = useMemo(() =>
    AGENTS.map((a) => avatarOverrides[a.id] ? { ...a, avatar: avatarOverrides[a.id] } : a),
    [avatarOverrides]
  );

  const handleAvatarChange = useCallback((agentId: string, newUrl: string) => {
    setAvatarOverrides((prev) => ({ ...prev, [agentId]: newUrl }));
  }, []);

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert("Image must be under 25MB"); return; }
    setAvatarUploading(true);
    const uploadAbort = new AbortController();
    const uploadTimer = window.setTimeout(() => uploadAbort.abort(), 60_000);
    try {
      const blob = await compressAvatarImage(file);
      const form = new FormData();
      form.append("file", new File([blob], `${activeAgent}-avatar.png`, { type: "image/png" }));
      form.append("agentId", activeAgent);
      const res = await fetch("/api/agent-avatar", {
        method: "POST",
        credentials: "include",
        body: form,
        signal: uploadAbort.signal,
      });
      if (!res.ok) { alert("Upload failed"); return; }
      const data = await res.json();
      if (data.avatarUrl) handleAvatarChange(activeAgent, data.avatarUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      alert(err instanceof DOMException && err.name === "AbortError" ? "Upload timed out" : `Upload failed: ${msg}`);
    } finally {
      clearTimeout(uploadTimer);
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }, [activeAgent, handleAvatarChange]);

  // Avatars now always use /api/agent-avatar route (checks uploads then public).
  // No HEAD-request discovery needed — the API is the single source of truth.

  const agent = agents.find((a) => a.id === activeAgent) || agents[0];

  // Filter messages by search query
  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => m.text.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  // Clear unread count when switching to an agent
  useEffect(() => {
    setUnreadCounts((prev) => ({ ...prev, [activeAgent]: 0 }));
    setLastSeenCounts((prev) => {
      const updated = { ...prev, [activeAgent]: messages.length };
      try { localStorage.setItem("chat_last_seen_counts", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [activeAgent, messages.length]);

  // Poll other agents’ chat for sidebar preview / unread (slower when tab hidden).
  useEffect(() => {
    const ms = dashboardTabVisible ? CROSS_AGENT_CHAT_MS_VISIBLE : CROSS_AGENT_CHAT_MS_HIDDEN;
    const tick = () => {
      AGENTS.forEach((a) => {
        if (a.id === activeAgent) return;
        fetch(`/api/chat?agent=${a.id}`, { credentials: "include", cache: "no-store" })
          .then(async (res) => {
            if (!res.ok) return null;
            return res.json();
          })
          .then((data) => {
            if (!data?.history?.length) return;
            const total = data.history.length;
            setLastSeenCounts((prev) => {
              const lastSeen = prev[a.id] || 0;
              if (lastSeen === 0) {
                const updated = { ...prev, [a.id]: total };
                try { localStorage.setItem("chat_last_seen_counts", JSON.stringify(updated)); } catch {}
                return updated;
              }
              const newMessages = Math.max(0, total - lastSeen);
              if (newMessages > 0) {
                setUnreadCounts((uPrev) => ({
                  ...uPrev,
                  [a.id]: newMessages,
                }));
                const updated = { ...prev, [a.id]: total };
                try { localStorage.setItem("chat_last_seen_counts", JSON.stringify(updated)); } catch {}
                return updated;
              }
              return prev;
            });
            const lastMsg = data.history[data.history.length - 1];
            setLastMessages((prev) => ({ ...prev, [a.id]: lastMsg.text }));
          })
          .catch(() => {});
      });
    };
    const interval = setInterval(tick, ms);
    return () => clearInterval(interval);
  }, [activeAgent, dashboardTabVisible]);

  useEffect(() => {
    if (activeAgent !== "tim") setTimWorkSelection(null);
  }, [activeAgent]);

  useEffect(() => {
    if (activeAgent !== "ghost") setGhostWorkSelection(null);
  }, [activeAgent]);

  // Load last messages for all agents on mount + initialize lastSeenCounts
  useEffect(() => {
    AGENTS.forEach((a) => {
      fetch(`/api/chat?agent=${a.id}`, { credentials: "include" })
        .then(async (res) => {
          if (!res.ok) return null;
          return res.json();
        })
        .then((data) => {
          if (!data?.history?.length) return;
          const total = data.history.length;
          const lastMsg = data.history[data.history.length - 1];
          setLastMessages((prev) => ({ ...prev, [a.id]: lastMsg.text }));
          setLastSeenCounts((prev) => {
            if (prev[a.id]) return prev;
            const updated = { ...prev, [a.id]: total };
            try { localStorage.setItem("chat_last_seen_counts", JSON.stringify(updated)); } catch {}
            return updated;
          });
        })
        .catch(() => {});
    });
  }, []);

  // Load chat history when agent changes
  useEffect(() => {
    if (loadedAgentRef.current === activeAgent) return;
    loadedAgentRef.current = activeAgent;

    fetch(`/api/chat?agent=${activeAgent}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          setMessages([]);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data?.history?.length) {
          setMessages([]);
          return;
        }
        setMessages(
          data.history.map(
            (msg: { role: string; text: string; timestamp: number; delegatedFrom?: string; fromAgent?: string }, i: number) => ({
              id: `history-${activeAgent}-${i}`,
              role: msg.role as "user" | "model",
              text: msg.text,
              timestamp: msg.timestamp,
              delegatedFrom: msg.delegatedFrom,
              fromAgent: msg.fromAgent,
            })
          )
        );
      })
      .catch(() => setMessages([]));
  }, [activeAgent]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agent-config?agent=${encodeURIComponent(activeAgent)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.voiceRuntime) return;
        const vr = data.voiceRuntime as {
          registryVoiceId?: string | null;
          envFallbackVoiceId?: string | null;
        };
        // Only use per-agent registry voices. INWORLD_VOICE_ID is often Suzi (Olivia) — applying it to
        // agents without ttsVoice (e.g. Ghost) produced the wrong read-aloud voice.
        const v =
          (typeof vr.registryVoiceId === "string" && vr.registryVoiceId.trim()) || null;
        setEffectiveTtsVoice(v);
      })
      .catch(() => {
        if (!cancelled) setEffectiveTtsVoice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAgent]);

  const handleReply = useCallback((msg: Message) => {
    setReplyTo({ id: msg.id, text: msg.text, role: msg.role });
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isLoading) return;
      const agentForTurn = activeAgent;

      // Prior turn's TTS can still be playing after the stream ends (isLoading false).
      // Stop it immediately so the next user message never stacks two voices.
      ttsQueueRef.current?.stop();
      ttsQueueRef.current = null;

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
        const controller = new AbortController();
        abortRef.current = controller;

        const body: {
          message: string;
          agent: string;
          workQueueContext?: string;
          uiContext?: string;
        } = { message: apiMessage, agent: activeAgent };
        if (activeAgent === "tim" && timWorkSelection) {
          body.workQueueContext = formatTimWorkQueueContext(timWorkSelection);
        }
        if (activeAgent === "ghost" && ghostWorkSelection) {
          body.workQueueContext = formatGhostWorkQueueContext(ghostWorkSelection);
        }
        if (activeAgent === "suzi") {
          body.uiContext = formatSuziWorkPanelContext({
            workPanelOpen: rightPanel === "reminders",
            subTab: suziWorkSubTab,
            focusedIntake: suziFocusedIntake,
            focusedPunchList: suziFocusedPunchList,
            focusedReminder: suziFocusedReminder,
            focusedNote: suziFocusedNote,
          });
        } else {
          const agentUi = formatAgentUiContext({
            agentId: activeAgent,
            rightPanel,
            timHasWorkQueueSelection:
              activeAgent === "tim" && timWorkSelection != null,
            ghostHasWorkQueueSelection:
              activeAgent === "ghost" && ghostWorkSelection != null,
            fridayTab: fridayDashboardTab,
            pennyTab: pennyDashboardTab,
            marniWorkSubTab: activeAgent === "marni" ? marniWorkSubTab : undefined,
          });
          if (agentUi) body.uiContext = agentUi;
        }

        const res = await fetch("/api/chat/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
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

        const voiceId = (effectiveTtsVoice ?? agent.ttsVoice)?.trim() || "";
        const ttsQueue = voiceId
          ? new TtsQueue({
              voice: voiceId,
              agentId: activeAgent,
              onStateChange: (state: TtsState) => {
                setTtsSpeaking(state === "speaking" || state === "loading");
              },
            })
          : null;
        ttsQueueRef.current = ttsQueue;

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
              } else if (parsed.delegatedFrom) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMsgId ? { ...m, delegatedFrom: parsed.delegatedFrom } : m
                  )
                );
              } else if (parsed.text) {
                // Detect tool-used markers and emit panel refresh events
                const toolMatch = parsed.text.match(/<!--toolUsed:(\w+)-->/g);
                if (toolMatch) {
                  for (const m of toolMatch) {
                    const name = m.replace("<!--toolUsed:", "").replace("-->", "");
                    panelBus.emit(name);
                  }
                }
                // Strip markers from displayed text
                const displayText = parsed.text.replace(/\n?<!--toolUsed:\w+-->/g, "");
                if (displayText) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === botMsgId ? { ...msg, text: msg.text + displayText } : msg
                    )
                  );
                  ttsQueue?.push(displayText);
                }
              }
            } catch {
              // skip malformed chunks
            }
          }
        }

        // Flush any remaining TTS text
        ttsQueue?.flush();

        // Play notification chime — skip if agent has TTS voice (avoid overlap)
        if (!voiceId) {
          try {
            const audio = new Audio("/sounds/notification.wav");
            audio.volume = 0.3;
            audio.play().catch(() => {});
          } catch {
            // ignore audio errors
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User cancelled — keep partial response as-is
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "model",
              text: "Failed to connect. Please try again.",
              timestamp: Date.now(),
            },
          ]);
        }
      } finally {
        abortRef.current = null;
        setIsLoading(false);
        syncChatSidebarAfterTurn(agentForTurn);
        void refreshDashboardSync();
      }
    },
    [
      isLoading,
      activeAgent,
      replyTo,
      effectiveTtsVoice,
      agent.ttsVoice,
      timWorkSelection,
      ghostWorkSelection,
      rightPanel,
      suziWorkSubTab,
      suziFocusedIntake,
      suziFocusedPunchList,
      suziFocusedReminder,
      suziFocusedNote,
      marniWorkSubTab,
      syncChatSidebarAfterTurn,
      refreshDashboardSync,
    ]
  );

  const stopResponse = useCallback(() => {
    abortRef.current?.abort();
    ttsQueueRef.current?.stop();
  }, []);

  const stopTts = useCallback(() => {
    ttsQueueRef.current?.stop();
    ttsQueueRef.current = null;
  }, []);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[#0a0f18]"
      style={{ backgroundColor: "#0a0f18" }}
    >
      {/* Mobile: Agent list (shown when no chat is open) */}
      <div className={`md:hidden flex-1 flex flex-col bg-[var(--bg-secondary)] ${mobileShowChat ? "hidden" : ""}`}>
        <div className="h-11 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3.5">
          <p
            className="text-xs font-medium text-[var(--text-tertiary)] leading-tight uppercase tracking-wide"
            title={SIDEBAR_HEADER_TITLE}
          >
            {SIDEBAR_HEADER_TITLE}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {AGENT_CATEGORIES.filter((c) => c !== "Toys").map((category) => {
            const categoryAgents = agents.filter((a) => a.category === category);
            if (categoryAgents.length === 0) return null;
            return (
              <div key={category}>
                <div className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {category}
                </div>
                {categoryAgents.map((a) => {
                  const unread = unreadCounts[a.id] || 0;
                  const preview = lastMessages[a.id] || "";
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        if (a.id !== activeAgent) {
                          loadedAgentRef.current = null;
                          setReplyTo(null);
                          setActiveAgent(a.id);
                          setRightPanel(defaultPanelFor(a.id));
                        }
                        setMobileShowChat(true);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-[var(--border-color)] ${
                        activeAgent === a.id ? "bg-[var(--bg-primary)]" : "hover:bg-[var(--bg-primary)]"
                      }`}
                    >
                      <div className="relative shrink-0">
                        <AgentAvatar
                          agentId={a.id}
                          name={a.name}
                          color={a.color}
                          src={a.avatar}
                          circleClassName="w-11 h-11 min-w-[44px] min-h-[44px]"
                          initialClassName="text-base font-medium text-white"
                        />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex min-w-0 w-full items-center gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                            <span
                              className={`min-w-0 truncate text-sm font-medium ${unread > 0 ? "text-white" : "text-[var(--text-primary)]"}`}
                            >
                              {a.name}
                            </span>
                            <span
                              className="shrink-0 flex w-[13px] items-center justify-center"
                              title={
                                agentHasUserWorkItem(a.id, {
                                  pendingTaskCount,
                                  testingTaskCount,
                                  timMessagingTaskCount,
                                  ghostContentTaskCount,
                                })
                                  ? "Work waiting for you"
                                  : "No items waiting for you"
                              }
                            >
                              <span
                                className={
                                  agentHasUserWorkItem(a.id, {
                                    pendingTaskCount,
                                    testingTaskCount,
                                    timMessagingTaskCount,
                                    ghostContentTaskCount,
                                  })
                                    ? "text-[var(--accent-orange)]"
                                    : "text-[var(--accent-green)]"
                                }
                                aria-label={
                                  agentHasUserWorkItem(a.id, {
                                    pendingTaskCount,
                                    testingTaskCount,
                                    timMessagingTaskCount,
                                    ghostContentTaskCount,
                                  })
                                    ? "Work waiting for you"
                                    : undefined
                                }
                                aria-hidden={
                                  !agentHasUserWorkItem(a.id, {
                                    pendingTaskCount,
                                    testingTaskCount,
                                    timMessagingTaskCount,
                                    ghostContentTaskCount,
                                  })
                                }
                              >
                                <WorkBellIcon size={11} />
                              </span>
                            </span>
                          </div>
                          {unread > 0 && (
                            <span className="flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-orange)] px-1 text-[11px] font-bold text-white">
                              {unread > 99 ? "99+" : unread}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] truncate">
                          {preview ? preview.slice(0, 60) + (preview.length > 60 ? "..." : "") : a.role}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: Chat view (shown when agent is selected) */}
      <div className={`md:hidden flex-1 flex flex-col min-w-0 bg-[var(--bg-primary)] ${mobileShowChat ? "" : "hidden"}`}>
        <div className="h-12 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-2">
          <button
            onClick={() => setMobileShowChat(false)}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15,18 9,12 15,6" />
            </svg>
          </button>
          <div className="relative shrink-0">
            <AgentAvatar
              agentId={agent.id}
              name={agent.name}
              color={agent.color}
              src={agent.avatar}
              circleClassName={`w-8 h-8 min-w-[32px] min-h-[32px]${ttsSpeaking && (activeAgent === "suzi" || activeAgent === "tim") ? " animate-pulse" : ""}`}
              style={{
                boxShadow:
                  ttsSpeaking && (activeAgent === "suzi" || activeAgent === "tim")
                    ? `0 0 12px ${agent.color}`
                    : undefined,
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{agent.name}</div>
            <div className="text-[11px] text-[var(--text-secondary)] truncate">{agent.role}</div>
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
          isLoading={isLoading}
          onStop={stopResponse}
          placeholder={agent.online ? `Message ${agent.name}...` : `${agent.name} is offline`}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          agentName={agent.name}
          ttsSpeaking={ttsSpeaking}
          onStopTts={stopTts}
        />
      </div>

      {/* Desktop: sidebar + chat + agent panel + status rail (grid reserves the right column) */}
      <div className="hidden md:grid md:flex-1 md:min-h-0 md:min-w-0 md:grid-cols-[200px_384px_minmax(0,1fr)_minmax(160px,10%)] md:grid-rows-1">
        <AgentSidebar
          agents={agents}
          activeAgent={activeAgent}
          unreadCounts={unreadCounts}
          pendingTaskCount={pendingTaskCount}
          testingTaskCount={testingTaskCount}
          timMessagingTaskCount={timMessagingTaskCount}
          ghostContentTaskCount={ghostContentTaskCount}
          onSelect={(id) => {
            if (id !== activeAgent) {
              loadedAgentRef.current = null;
              setReplyTo(null);
              setActiveAgent(id);
              setRightPanel(defaultPanelFor(id));
            }
          }}
        />

      {/* Desktop: Main chat area (narrow) */}
      <div className="flex w-full min-w-0 min-h-0 flex-col bg-[var(--bg-primary)]">
        {/* Top bar */}
        <div className="h-11 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <div className="flex-1 min-w-0" />

          {/* Action icons */}
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
            {/* Mobile only: kanban link */}
            {agentHasKanban(activeAgent) &&
              activeAgent !== "tim" &&
              activeAgent !== "ghost" &&
              activeAgent !== "marni" && (
              <Link
                href="/kanban"
                className="md:hidden p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
                title="Pipeline board"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="5" height="18" rx="1" />
                  <rect x="10" y="3" width="5" height="12" rx="1" />
                  <rect x="17" y="3" width="5" height="8" rx="1" />
                </svg>
              </Link>
            )}
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
          isLoading={isLoading}
          onStop={stopResponse}
          placeholder={agent.online ? `Message ${agent.name}...` : `${agent.name} is offline`}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          agentName={agent.name}
          ttsSpeaking={ttsSpeaking}
          onStopTts={stopTts}
        />
      </div>

      {/* Desktop: Right panel with persistent agent header */}
      <div className="flex min-w-0 min-h-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-secondary)]">
        {/* Persistent agent header + nav icons */}
        <div className="shrink-0 border-b border-[var(--border-color)] px-4 py-3 flex items-center gap-3 min-w-0">
          <div
            className="w-[74px] h-[74px] rounded-full overflow-hidden shrink-0 relative group cursor-pointer"
            onClick={() => avatarInputRef.current?.click()}
          >
            <AgentAvatar
              agentId={agent.id}
              name={agent.name}
              color={agent.color}
              src={agent.avatar}
              circleClassName="w-full h-full min-w-0 min-h-0"
              initialClassName="text-xl font-medium text-white"
            />
            <div className="absolute inset-0 z-[3] bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full pointer-events-none">
              {avatarUploading ? (
                <svg className="w-6 h-6 text-white animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              )}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>
          <div className="flex min-w-0 items-center gap-[0.25in] shrink">
            <div className="min-w-0">
              <span className="text-sm font-semibold truncate block" style={{ color: agent.color }}>
                {agent.name}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] block truncate">{agent.role}</span>
            </div>
            {/* Panel nav — next to agent name */}
            <div className="flex items-center gap-1 shrink-0">
            {agentHasKanban(activeAgent) &&
              activeAgent !== "tim" &&
              activeAgent !== "ghost" &&
              activeAgent !== "marni" && (
              <button
                type="button"
                onClick={() => setRightPanel("kanban")}
                className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                  rightPanel === "kanban"
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title="Pipeline board"
              >
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="5" height="18" rx="1" />
                  <rect x="10" y="3" width="5" height="12" rx="1" />
                  <rect x="17" y="3" width="5" height="8" rx="1" />
                </svg>
              </button>
            )}
            {activeAgent === "marni" && (
              <button
                type="button"
                onClick={() => setRightPanel("marni-work")}
                className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                  rightPanel === "marni-work"
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title="Work panel — distribution queue & knowledge base"
              >
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <line x1="8" y1="7" x2="16" y2="7" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
            )}
            {(activeAgent === "friday" || activeAgent === "penny") && (
              <button
                onClick={() => setRightPanel("dashboard")}
                className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                  rightPanel === "dashboard"
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title={activeAgent === "penny" ? "Packages dashboard" : "Friday packages (active ops)"}
              >
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
            )}
            {activeAgent === "tim" && (
              <button
                type="button"
                onClick={() => setRightPanel("messages")}
                className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                  rightPanel === "messages"
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title="Tim work panel — Active & Pending queues, CRM directory"
              >
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </button>
            )}
            {activeAgent === "ghost" && (
              <button
                type="button"
                onClick={() => setRightPanel("messages")}
                className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                  rightPanel === "messages"
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title="Ghost work panel — content queue & workspace"
              >
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </button>
            )}
            {activeAgent === "king" && (
              <button
                type="button"
                onClick={() => setRightPanel("costs")}
                className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                  rightPanel === "costs"
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                title="Cost-Usage"
              >
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </button>
            )}
            {activeAgent === "suzi" && (
              <>
                <button
                  onClick={() => setRightPanel("reminders")}
                  className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                    rightPanel === "reminders"
                      ? "text-[var(--accent-green)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                  title="Suzi work — Punch list, Reminders, Notes"
                >
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setRightPanel("info")}
              className={`p-1.5 rounded-lg cursor-pointer hover:bg-[var(--bg-primary)] ${
                rightPanel === "info"
                  ? "text-[var(--accent-green)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
              title="Agent info"
            >
              <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
            </div>
          </div>
          <div className="flex-1 min-w-2 min-h-[1px]" aria-hidden />
          <div className="hidden md:block shrink-0 pr-[0.25in]">
            <AgentPanelPrinciples />
          </div>
        </div>
        {/* Panel content */}
        <div className="flex-1 min-h-0 flex">
          {activeAgent === "tim" && rightPanel === "messages" ? (
            <TimAgentPanel
              messageQueueCount={timMessagingTaskCount}
              pendingQueueCount={timPendingQueueCount}
              onTimWorkSelectionChange={setTimWorkSelection}
            />
          ) : activeAgent === "ghost" && rightPanel === "messages" ? (
            <GhostAgentPanel
              contentQueueCount={ghostContentTaskCount}
              onGhostWorkSelectionChange={setGhostWorkSelection}
            />
          ) : rightPanel === "marni-work" && activeAgent === "marni" ? (
            <MarniWorkPanel
              onClose={() => setRightPanel("info")}
              onWorkTabChange={onMarniWorkTabChange}
            />
          ) : rightPanel === "kanban" && agentHasKanban(activeAgent) ? (
            <KanbanInlinePanel onClose={() => setRightPanel("info")} agentId={activeAgent} />
          ) : rightPanel === "dashboard" && activeAgent === "friday" ? (
            <FridayDashboardPanel
              onClose={() => setRightPanel("info")}
              onSwitchToAgent={(id) => setActiveAgent(id)}
              pendingTaskCount={pendingTaskCount}
              initialWorkTab={paramPanel === "tasks" ? "tasks" : undefined}
            />
          ) : rightPanel === "dashboard" && activeAgent === "penny" ? (
            <PennyDashboardPanel onClose={() => setRightPanel("info")} />
          ) : rightPanel === "reminders" && activeAgent === "suzi" ? (
            <SuziRemindersPanel
              onClose={() => setRightPanel("info")}
              onSubTabChange={setSuziWorkSubTab}
              focusedIntake={suziFocusedIntake}
              onFocusedIntakeChange={(item) => {
                setSuziFocusedIntake(item);
                if (item) {
                  setSuziFocusedPunchList(null);
                  setSuziFocusedReminder(null);
                  setSuziFocusedNote(null);
                }
              }}
              focusedPunchList={suziFocusedPunchList}
              onFocusedPunchListChange={(item) => {
                setSuziFocusedPunchList(item);
                if (item) {
                  setSuziFocusedIntake(null);
                  setSuziFocusedReminder(null);
                  setSuziFocusedNote(null);
                }
              }}
              focusedReminder={suziFocusedReminder}
              onFocusedReminderChange={(item) => {
                setSuziFocusedReminder(item);
                if (item) {
                  setSuziFocusedIntake(null);
                  setSuziFocusedPunchList(null);
                  setSuziFocusedNote(null);
                }
              }}
              focusedNote={suziFocusedNote}
              onFocusedNoteChange={(item) => {
                setSuziFocusedNote(item);
                if (item) {
                  setSuziFocusedIntake(null);
                  setSuziFocusedPunchList(null);
                  setSuziFocusedReminder(null);
                }
              }}
            />
          ) : rightPanel === "costs" && activeAgent === "king" ? (
            <KingCostPanel />
          ) : (
            <AgentInfoPanel agent={agent} onAvatarChange={handleAvatarChange} />
          )}
        </div>
      </div>

        <StatusRail agents={agents} sharedNotifications={dashboardNotifications} />
      </div>

    </div>
  );
}
