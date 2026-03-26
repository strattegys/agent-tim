"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { MarkdownRenderer, artifactTabLabel } from "@/components/shared/ArtifactViewer";
import ArtifactTabScrollRow from "@/components/shared/ArtifactTabScrollRow";

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

For the fastest CRM updates, use **Name:**, **Company:**, and **Title:** lines, or paste a **LinkedIn profile URL** — when Unipile is configured on the server, we pull **name, headline, and current company** from that profile into the CRM contact.

Use the **Package raise** tab for campaign rules (tone, boundaries). Use the main **Tim** chat (left) to refine this input — it sees this work item.`;

const IDEA_DIRECTIONS = `**Describe your article idea** — topic, angle, audience, or rough concept.

Use other tabs for prior notes. Use the main **Tim** chat for help — it sees this work item.`;

interface TimIntakeWorkspaceProps {
  task: MessagingTask;
  resolving: boolean;
  onSubmitInput: (notes: string) => Promise<void>;
  /** Same document icon row as ArtifactViewer — warm-outreach contact lines under the workflow title. */
  documentHeaderDetail?: ReactNode;
}

/**
 * Full-width intake: chronological artifact tabs (scroll) + contact/idea + Submit. No duplicate Tim chat — main chat has queue context.
 */
export default function TimIntakeWorkspace({
  task,
  resolving,
  onSubmitInput,
  documentHeaderDetail,
}: TimIntakeWorkspaceProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"intake" | string>("intake");
  const [intakeText, setIntakeText] = useState("");

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

  const { packageRaiseArtifacts, otherArtifacts } = useMemo(() => {
    const briefs: ArtifactRow[] = [];
    const rest: ArtifactRow[] = [];
    for (const a of artifacts) {
      if (a.stage.toUpperCase() === "PACKAGE_BRIEF") briefs.push(a);
      else rest.push(a);
    }
    return { packageRaiseArtifacts: briefs, otherArtifacts: rest };
  }, [artifacts]);

  const newestArtifactId = useMemo(() => {
    if (artifacts.length < 2) return null;
    return artifacts.reduce((best, a) =>
      new Date(a.createdAt) > new Date(best.createdAt) ? a : best
    ).id;
  }, [artifacts]);

  const pLen = packageRaiseArtifacts.length;
  const activeTabIndex = useMemo(() => {
    if (activeTab === "intake") return pLen;
    const pi = packageRaiseArtifacts.findIndex((a) => a.id === activeTab);
    if (pi >= 0) return pi;
    const oi = otherArtifacts.findIndex((a) => a.id === activeTab);
    if (oi >= 0) return pLen + 1 + oi;
    return 0;
  }, [activeTab, pLen, packageRaiseArtifacts, otherArtifacts]);

  return (
    <div className="flex flex-col h-full min-h-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden shadow-sm">
      {documentHeaderDetail != null ? (
        <div className="flex items-start gap-3 px-5 py-3 border-b border-[var(--border-color)] shrink-0 min-w-0">
          <svg
            className="shrink-0 mt-0.5"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-green)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <div className="min-w-0 flex flex-col gap-1">
            <span className="text-sm font-bold text-[var(--text-primary)]">{task.workflowName}</span>
            <div className="min-w-0 text-[var(--text-secondary)]">{documentHeaderDetail}</div>
          </div>
        </div>
      ) : null}
      <div className="px-3 py-2 border-b border-[var(--border-color)] shrink-0 min-w-0">
        <ArtifactTabScrollRow activeIndex={activeTabIndex} className="min-w-0">
          {packageRaiseArtifacts.map((a, i) => {
            const isNewest = a.id === newestArtifactId;
            return (
              <button
                key={a.id}
                type="button"
                data-artifact-tab-index={i}
                onClick={() => setActiveTab(a.id)}
                className={`text-left text-[10px] px-2.5 py-1.5 rounded-lg transition-colors shrink-0 max-w-[200px] truncate ${
                  activeTab === a.id
                    ? "bg-[var(--accent-green)] text-white font-semibold"
                    : isNewest
                      ? "bg-[var(--bg-tertiary)] text-[var(--accent-green)] ring-2 ring-[var(--accent-green)]/70 font-semibold"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {artifactTabLabel(a)}
              </button>
            );
          })}
          <button
            type="button"
            data-artifact-tab-index={pLen}
            onClick={() => setActiveTab("intake")}
            className={`text-left text-[10px] px-2.5 py-1.5 rounded-lg transition-colors shrink-0 font-semibold ${
              activeTab === "intake"
                ? "bg-[var(--accent-green)] text-white"
                : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {intakeTabLabel}
          </button>
          {otherArtifacts.map((a, j) => {
            const flatIdx = pLen + 1 + j;
            const isNewest = a.id === newestArtifactId;
            return (
              <button
                key={a.id}
                type="button"
                data-artifact-tab-index={flatIdx}
                onClick={() => setActiveTab(a.id)}
                className={`text-left text-[10px] px-2.5 py-1.5 rounded-lg transition-colors shrink-0 max-w-[200px] truncate ${
                  activeTab === a.id
                    ? "bg-[var(--accent-green)] text-white font-semibold"
                    : isNewest
                      ? "bg-[var(--bg-tertiary)] text-[var(--accent-green)] ring-2 ring-[var(--accent-green)]/70 font-semibold"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {artifactTabLabel(a)}
              </button>
            );
          })}
        </ArtifactTabScrollRow>
      </div>

      <div className="shrink-0 flex items-center justify-end gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <button
          type="button"
          disabled={resolving || !intakeText.trim()}
          onClick={() => onSubmitInput(intakeText.trim())}
          title={!intakeText.trim() ? "Add text above before submitting" : undefined}
          className="text-[11px] px-4 py-2 rounded-md border border-[var(--accent-green)]/40 bg-[var(--accent-green)]/15 text-[var(--text-primary)] font-semibold hover:bg-[var(--accent-green)]/25 disabled:opacity-40 disabled:pointer-events-none"
        >
          {resolving ? "Submitting…" : "Submit"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {activeTab === "intake" ? (
          <div className="p-4 space-y-4 flex-1 flex flex-col min-h-0">
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/80 px-3 py-2.5 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--accent-green)]">
                What to do
              </p>
              <div className="prose prose-invert prose-sm max-w-none text-[var(--text-secondary)]">
                <MarkdownRenderer content={isAwaiting ? AWAITING_DIRECTIONS : IDEA_DIRECTIONS} />
              </div>
              {task.humanAction ? (
                <p className="text-[11px] text-[var(--text-primary)] border-t border-[var(--border-color)]/60 pt-2">
                  <span className="text-[var(--text-tertiary)]">Task: </span>
                  {task.humanAction}
                </p>
              ) : null}
            </div>

            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <label className="text-[10px] font-semibold text-[var(--text-tertiary)]">
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
                className="flex-1 min-h-[200px] w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-y focus:outline-none focus:border-[var(--accent-green)]/50"
              />
            </div>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-[var(--text-tertiary)] text-sm">Loading…</div>
        ) : activeArtifact ? (
          <div className="p-4 prose prose-invert prose-sm max-w-none min-h-0">
            <MarkdownRenderer content={activeArtifact.content} />
          </div>
        ) : (
          <div className="p-8 text-center text-[var(--text-tertiary)] text-sm">No artifact</div>
        )}
      </div>
    </div>
  );
}
