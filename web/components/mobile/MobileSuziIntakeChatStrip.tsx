"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { panelBus } from "@/lib/events";
import { SESSION_HISTORY_FOCUS_SUZI_WORK } from "@/lib/chat-stream-options";
import {
  formatSuziWorkPanelContext,
  type SuziFocusedIntake,
} from "@/lib/suzi-work-panel";

/** Same key as CommandCentralClient — desktop chat picks up focus if they open `/` later. */
const SUZI_INTAKE_FOCUS_STORAGE = "suzi_intake_focus_v1";

type ChatMsg = { id: string; role: "user" | "model"; text: string; timestamp: number };

function persistIntakeFocus(f: SuziFocusedIntake | null) {
  try {
    if (f?.id) {
      localStorage.setItem(SUZI_INTAKE_FOCUS_STORAGE, JSON.stringify(f));
    } else {
      localStorage.removeItem(SUZI_INTAKE_FOCUS_STORAGE);
    }
  } catch {
    /* ignore */
  }
}

async function parseJsonResponse(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      r.ok
        ? "Server sent a non-JSON response. Try signing in again or refreshing."
        : `Request failed (${r.status}).`
    );
  }
}

export function MobileSuziIntakeChatStrip({
  focusedIntake,
}: {
  focusedIntake: SuziFocusedIntake | null;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    persistIntakeFocus(focusedIntake);
  }, [focusedIntake]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/chat?agent=suzi", {
          credentials: "include",
          cache: "no-store",
        });
        const data = await parseJsonResponse(r);
        if (!r.ok) {
          if (r.status === 401) {
            window.location.href = "/login";
            return;
          }
          throw new Error(typeof data.error === "string" ? data.error : "Failed to load chat");
        }
        if (cancelled) return;
        const history = data.history as
          | { role: string; text: string; timestamp: number }[]
          | undefined;
        if (!Array.isArray(history)) {
          setMessages([]);
          return;
        }
        setMessages(
          history.map((m, i) => ({
            id: `h-${m.timestamp}-${i}`,
            role: m.role === "user" ? "user" : "model",
            text: String(m.text ?? ""),
            timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
          }))
        );
        setLoadErr(null);
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : "Could not load chat");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: ChatMsg = {
        id: `user-${Date.now()}`,
        role: "user",
        text: trimmed,
        timestamp: Date.now(),
      };
      const botMsgId = `bot-${Date.now()}`;
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setDraft("");

      const uiContext = formatSuziWorkPanelContext({
        workPanelOpen: true,
        subTab: "intake",
        focusedIntake,
        focusedPunchList: null,
        focusedReminder: null,
        focusedNote: null,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            agent: "suzi",
            uiContext,
            sessionHistoryMaxMessages: SESSION_HISTORY_FOCUS_SUZI_WORK,
          }),
          signal: controller.signal,
        });

        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!res.ok || !res.body) {
          const data = (await parseJsonResponse(res).catch(() => ({}))) as Record<string, unknown>;
          const err =
            typeof data.error === "string" ? data.error : `Chat failed (${res.status})`;
          setMessages((prev) => [
            ...prev,
            { id: `err-${Date.now()}`, role: "model", text: `Error: ${err}`, timestamp: Date.now() },
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
              const parsed = JSON.parse(data) as Record<string, unknown>;
              if (parsed.error) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMsgId ? { ...m, text: `Error: ${String(parsed.error)}` } : m
                  )
                );
              } else if (typeof parsed.text === "string" && parsed.text.length > 0) {
                const chunkText = parsed.text;
                const toolMatch = chunkText.match(/<!--toolUsed:(\w+)-->/g);
                if (toolMatch) {
                  for (const m of toolMatch) {
                    const name = m.replace("<!--toolUsed:", "").replace("-->", "");
                    panelBus.emit(name);
                  }
                }
                const displayText = chunkText.replace(/\n?<!--toolUsed:\w+-->/g, "");
                if (displayText) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === botMsgId ? { ...msg, text: msg.text + displayText } : msg
                    )
                  );
                }
              }
            } catch {
              /* skip bad chunk */
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "model",
            text: "Could not reach the assistant. Try again.",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        abortRef.current = null;
        setIsLoading(false);
      }
    },
    [focusedIntake, isLoading]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="rounded-lg border border-white/10 bg-[#0e1621] p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[#6b8a9e]">
        Chat with Suzi
      </h3>
      <p className="mt-1 text-[11px] leading-snug text-[#8b9bab]">
        {focusedIntake
          ? "She sees the highlighted capture below (title, link, notes). Ask her to summarize, expand, or update it."
          : "Select a capture below so Suzi knows which item you mean."}
      </p>
      {loadErr ? <p className="mt-2 text-xs text-amber-400">{loadErr}</p> : null}

      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded border border-white/10 bg-[#0a0f18] p-2">
        {messages.length === 0 && !loadErr ? (
          <p className="text-[11px] text-[#5c6d7c]">No messages yet — say hi or ask about the link.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded px-2 py-1.5 text-[12px] leading-snug ${
                m.role === "user"
                  ? "ml-4 bg-[#2b5278]/40 text-[#e8ecf0]"
                  : "mr-4 bg-white/5 text-[#d0d6dc]"
              }`}
            >
              <span className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide text-[#6b8a9e]">
                {m.role === "user" ? "You" : "Suzi"}
              </span>
              {m.text || (isLoading && m.role === "model" ? "…" : "\u00a0")}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage(draft);
            }
          }}
          disabled={isLoading}
          rows={3}
          placeholder="Message Suzi…"
          className="w-full resize-none rounded border border-white/15 bg-[#0a0f18] px-2 py-1.5 text-sm text-white placeholder:text-[#5c6d7c] disabled:opacity-50"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isLoading || !draft.trim()}
            onClick={() => void sendMessage(draft)}
            className="flex-1 rounded-lg bg-[#1D9E75] py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-white/20 px-3 py-2 text-sm text-[#e2e4e8]"
            >
              Stop
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
