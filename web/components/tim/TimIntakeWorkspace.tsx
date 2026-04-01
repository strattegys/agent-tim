"use client";

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  MarkdownRenderer,
  artifactTabLabel,
  type ArtifactConfirmedWorkflowAction,
} from "@/components/shared/ArtifactViewer";

type ArtifactRow = { id: string; stage: string; name: string; content: string; createdAt: string };

interface MessagingTask {
  itemId: string;
  stage: string;
  stageLabel: string;
  humanAction: string;
  workflowName: string;
  workflowType: string;
}

/** Oldest left → newest right */
function sortArtifactsByCreatedAt(list: ArtifactRow[]): ArtifactRow[] {
  return [...list].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

const AWAITING_DIRECTIONS = `**Add the next contact** for this outreach workflow.

Include:
- **Full name**
- **LinkedIn profile URL** (needed to send messages)
- **How you know them** and any context that should shape the message
- Optional: company, role, or notes from a recent conversation

For the fastest CRM updates, use **Name:**, **Company:**, and **Title:** lines (in that order is easiest to parse), or paste a **LinkedIn profile URL** — when Unipile is configured on the server, we pull **name, headline, and current company** from that profile into the CRM contact.

**After you submit:** In the **Researching** step, Tim must **look this person up in Twenty CRM** (by name / LinkedIn / email). If they are **not** in the CRM, he **creates** the contact; if they **are**, he **updates** name, company, and title on their record. The **Name / Company / Title** lines on your queue card come from that CRM person — if Tim skips this, the card stays empty even when the message draft is ready.

Use **History** on the right for package raise and prior steps (newest at top). Use the main **Tim** chat (left) to refine this input — it sees this work item.`;

function ideaDirectionsMarkdown(chatAgentLabel: string): string {
  return `**Describe your article idea** — topic, angle, audience, or rough concept.

Use **History** on the right for prior notes (newest at top). Use the main **${chatAgentLabel}** chat for help — it sees this work item.`;
}

interface TimIntakeWorkspaceProps {
  task: MessagingTask;
  resolving: boolean;
  onSubmitInput: (notes: string) => Promise<void>;
  /** Under the title row — same as ArtifactViewer `headerDetail` (e.g. Tim name / LinkedIn / company / title). */
  headerDetail?: ReactNode;
  /** Shown next to the workflow title (e.g. queue item + person UUIDs). */
  titleAccessory?: ReactNode;
  /** Confirmed secondary actions (Replied, End sequence, …) — same pattern as ArtifactViewer header. */
  confirmedWorkflowActions?: ArtifactConfirmedWorkflowAction[];
  /** Sidebar agent name in the idea-intake copy (default Tim; use Ghost for Ghost’s queue). */
  chatAgentLabel?: string;
}

/**
 * Full-width intake: chronological artifact tabs (scroll) + contact/idea + Submit. No duplicate Tim chat — main chat has queue context.
 */
export default function TimIntakeWorkspace({
  task,
  resolving,
  onSubmitInput,
  headerDetail,
  titleAccessory,
  confirmedWorkflowActions,
  chatAgentLabel = "Tim",
}: TimIntakeWorkspaceProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"intake" | string>("intake");
  const [intakeText, setIntakeText] = useState("");
  const [busyWorkflowActionId, setBusyWorkflowActionId] = useState<string | null>(null);

  const isAwaiting = task.stage === "AWAITING_CONTACT";
  const intakeTabLabel = isAwaiting ? "Contact details" : "Article idea";

  useEffect(() => {
    setActiveTab("intake");
    setIntakeText("");
  }, [task.itemId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/crm/artifacts?workflowItemId=${encodeURIComponent(task.itemId)}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setArtifacts(sortArtifactsByCreatedAt((data.artifacts || []) as ArtifactRow[]));
      })
      .catch(() => {
        if (!cancelled) setArtifacts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task.itemId]);

  const activeArtifact = activeTab !== "intake" ? artifacts.find((a) => a.id === activeTab) : null;

  const artifactsNewestFirst = useMemo(
    () =>
      [...artifacts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [artifacts]
  );

  const historyRailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = historyRailRef.current;
    if (!root) return;
    const key = activeTab === "intake" ? "intake" : activeTab;
    const el = root.querySelector(`[data-intake-history="${key}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeTab]);

  const historyButtonClass = (selected: boolean) =>
    `w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
      selected
        ? "border-[var(--accent-green)]/55 bg-[var(--accent-green)]/14 text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--accent-green)]/35"
        : "border-[var(--border-color)]/60 bg-[var(--bg-secondary)]/80 text-[var(--text-secondary)] hover:border-[var(--border-color)] hover:bg-[var(--bg-secondary)]"
    }`;

  const canSubmit = intakeText.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-sm">
      {/* Match ArtifactViewer: title + actions, then full-width detail strip */}
      <div className="shrink-0 border-b border-[var(--border-color)]">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 py-2.5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <svg
              className="mt-0.5 shrink-0 opacity-70"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-0 text-sm font-medium leading-snug text-[var(--text-chat-body)]">
                {task.workflowName}
              </span>
              {titleAccessory ? <span className="min-w-0 shrink">{titleAccessory}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {(confirmedWorkflowActions ?? []).map((a) => {
              const tone =
                a.variant === "danger"
                  ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  : a.variant === "amber"
                    ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
              const wfBusy = busyWorkflowActionId !== null;
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={wfBusy || resolving}
                  onClick={async () => {
                    if (!window.confirm(a.confirmMessage)) return;
                    setBusyWorkflowActionId(a.id);
                    try {
                      await a.onConfirm();
                    } finally {
                      setBusyWorkflowActionId(null);
                    }
                  }}
                  className={`rounded border px-2.5 py-1 text-[10px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${tone}`}
                >
                  {busyWorkflowActionId === a.id ? "…" : a.label}
                </button>
              );
            })}
            <button
              type="button"
              disabled={resolving || !canSubmit}
              title={!canSubmit ? "Add contact or idea text before submitting" : undefined}
              onClick={() => void onSubmitInput(intakeText.trim())}
              className="rounded border border-[var(--accent-green)]/35 bg-[var(--accent-green)]/8 px-3 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-green)]/12 hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-50"
            >
              {resolving ? "Submitting…" : "Submit"}
            </button>
          </div>
        </div>
        {headerDetail ? (
          <div className="w-full min-w-0 border-t border-[var(--border-color)]/50 px-5 py-2.5">
            <div className="w-full min-w-0 text-[var(--text-tertiary)] [&_a]:text-[var(--text-secondary)] [&_a:hover]:text-[var(--text-primary)]">
              {headerDetail}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-[var(--border-color)]">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {activeTab === "intake" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
                <div className="flex shrink-0 flex-col gap-2">
                  <label className="text-[10px] font-medium text-[var(--text-tertiary)]">
                    {isAwaiting ? "Paste contact & context" : "Your idea"}
                  </label>
                  <textarea
                    value={intakeText}
                    onChange={(e) => setIntakeText(e.target.value)}
                    placeholder={
                      isAwaiting
                        ? "Name, LinkedIn URL, how you know them, notes…"
                        : "Topic, angle, audience, links…"
                    }
                    className="min-h-[5.5rem] h-[7rem] max-h-[min(11rem,32svh)] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[13px] text-[var(--text-chat-body)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-color)] focus:outline-none"
                  />
                </div>

                <div className="shrink-0 space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/80 px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                    What to do
                  </p>
                  <div className="max-w-none text-[var(--text-chat-body)]">
                    <MarkdownRenderer
                      content={isAwaiting ? AWAITING_DIRECTIONS : ideaDirectionsMarkdown(chatAgentLabel)}
                    />
                  </div>
                  {task.humanAction ? (
                    <p className="border-t border-[var(--border-color)]/60 pt-2 text-[11px] text-[var(--text-chat-body)]">
                      <span className="text-[var(--text-tertiary)]">Task: </span>
                      {task.humanAction}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : loading ? (
              <div className="p-8 text-center text-sm text-[var(--text-tertiary)]">Loading…</div>
            ) : activeArtifact ? (
              <div className="min-h-0 max-w-none p-4 text-[var(--text-chat-body)]">
                <MarkdownRenderer content={activeArtifact.content} />
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-[var(--text-tertiary)]">No artifact</div>
            )}
          </div>
        </div>

        <aside
          className="flex min-h-0 w-[min(13.5rem,32vw)] shrink-0 flex-col bg-[var(--bg-primary)]/25"
          aria-label="Artifact history"
        >
          <div className="shrink-0 border-b border-[var(--border-color)] px-2.5 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              History
            </p>
            <p className="mt-0.5 text-[8px] leading-snug text-[var(--text-tertiary)]">
              Intake first · then newest artifacts
            </p>
          </div>
          <div
            ref={historyRailRef}
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
          >
            <button
              type="button"
              data-intake-history="intake"
              onClick={() => setActiveTab("intake")}
              className={historyButtonClass(activeTab === "intake")}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[8px] font-medium uppercase tracking-wide opacity-85">
                  Your task
                </span>
                <span className="text-[10px] font-medium leading-snug">{intakeTabLabel}</span>
              </span>
            </button>
            {artifactsNewestFirst.map((a) => (
              <button
                key={a.id}
                type="button"
                data-intake-history={a.id}
                onClick={() => setActiveTab(a.id)}
                className={historyButtonClass(activeTab === a.id)}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[8px] font-medium uppercase tracking-wide opacity-85">
                    {a.stage}
                  </span>
                  <span className="line-clamp-2 break-words text-[10px] font-medium leading-snug">
                    {artifactTabLabel(a)}
                  </span>
                  <span className="text-[8px] text-[var(--text-tertiary)]">
                    {a.createdAt
                      ? new Date(a.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
