"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  type ReactNode,
} from "react";
import ChatInput from "@/components/ChatInput";
import ArtifactTabScrollRow from "@/components/shared/ArtifactTabScrollRow";
import {
  extractPlainDmFromDraftMarkdown,
  recomposeWarmLinkedInDmArtifact,
  splitWarmLinkedInDmArtifact,
  type WarmDmArtifactSplit,
} from "@/lib/warm-outreach-draft";

interface Artifact {
  id: string;
  workflowItemId: string;
  workflowId: string;
  stage: string;
  name: string;
  type: string;
  content: string;
  createdAt: string;
}

interface PersonItem {
  itemId: string;
  stage: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  createdAt: string;
}

/** Header actions that require browser confirm before running (e.g. Tim Replied / End sequence). */
export interface ArtifactConfirmedWorkflowAction {
  id: string;
  label: string;
  confirmMessage: string;
  onConfirm: () => Promise<void>;
  variant?: "neutral" | "amber" | "danger";
}

interface ArtifactViewerProps {
  /** Fetch artifacts for this workflow item */
  workflowItemId?: string;
  /** Or fetch all artifacts for a workflow */
  workflowId?: string;
  /** Pre-loaded artifact to display */
  artifact?: Artifact;
  /** "person" shows a people table, "content" shows artifact markdown */
  itemType?: string;
  /** Focus on a specific stage's artifact */
  focusStage?: string;
  /** Title to display in header (e.g. workflow name) */
  title?: string;
  /** Agent that owns this artifact (for chat header) */
  agentId?: string;
  /** If set, show a Submit button that resolves the active task then closes */
  onSubmitTask?: () => Promise<void>;
  /** Shown next to Submit; each runs only after `confirm()` (workflow advances). */
  confirmedWorkflowActions?: ArtifactConfirmedWorkflowAction[];
  /**
   * When true with workflowId, load every artifact in the workflow (all items, full history).
   * Use for package-card Inspect — person-type workflows default to a people table without this.
   */
  allWorkflowArtifacts?: boolean;
  /** modal = fullscreen dimmed overlay (default). inline = fills parent (e.g. Tim work queue detail pane). */
  variant?: "modal" | "inline";
  /** inline only: stack Tim chat under the artifact (wider draft area). Default side. */
  chatPlacement?: "side" | "bottom";
  /** Show artifact tabs even when only one artifact (testing-style tab bar). */
  alwaysShowArtifactTabs?: boolean;
  /** Inline artifact chat (side/bottom). Tim work queue uses main Tim chat instead. */
  showArtifactChat?: boolean;
  /** Created/stage footer under the document */
  showArtifactFooter?: boolean;
  /** When set (ms), re-fetch artifacts on an interval — picks up tool-driven DB updates (e.g. Tim editing draft). Paused while editing or saving. */
  pollArtifactsMs?: number;
  /**
   * Stages (e.g. MESSAGE_DRAFT, REPLY_DRAFT) where the editor shows only the LinkedIn message body
   * (enrichment / rationale collapsed; optional “full draft” toggle).
   */
  linkedInDmBodyStages?: string[];
  /** When the user switches artifact tabs (or data loads), for Tim work-queue → main chat context. */
  onActiveArtifactChange?: (info: { stage: string; label: string } | null) => void;
  onClose: () => void;
  /** Shown under the header title (e.g. Tim warm-outreach contact name / company / title). */
  headerDetail?: ReactNode;
}

/**
 * Inspect modal — for content workflows shows artifact tabs,
 * for person workflows shows a people table grouped by stage.
 */
const AGENT_INFO: Record<string, { name: string; role: string; color: string }> = {
  ghost: { name: "Ghost", role: "Content Research & Strategy", color: "#4A90D9" },
  marni: { name: "Marni", role: "Content Distribution", color: "#D4A017" },
  scout: { name: "Scout", role: "Prospect Discovery", color: "#2563EB" },
  tim: { name: "Tim", role: "Outbound & Messaging", color: "#1D9E75" },
  penny: { name: "Penny", role: "Chief Success Agent", color: "#E67E22" },
  friday: { name: "Friday", role: "Operations & Tasks", color: "#9B59B6" },
};

export default function ArtifactViewer({
  workflowItemId,
  workflowId,
  artifact: preloaded,
  itemType = "content",
  title,
  agentId,
  onSubmitTask,
  confirmedWorkflowActions,
  allWorkflowArtifacts = false,
  variant = "modal",
  chatPlacement = "side",
  alwaysShowArtifactTabs = false,
  showArtifactChat = true,
  showArtifactFooter = true,
  pollArtifactsMs,
  linkedInDmBodyStages,
  onActiveArtifactChange,
  onClose,
  headerDetail,
}: ArtifactViewerProps) {
  const isInline = variant === "inline";
  const chatBelow = isInline && chatPlacement === "bottom" && showArtifactChat;
  const isPerson = itemType === "person";
  const usePeopleView = isPerson && !allWorkflowArtifacts;

  // Content mode state
  const [artifacts, setArtifacts] = useState<Artifact[]>(preloaded ? [preloaded] : []);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFullLinkedInDraft, setShowFullLinkedInDraft] = useState(false);
  const warmDmSplitRef = useRef<WarmDmArtifactSplit | null>(null);
  const blockArtifactPollRef = useRef(false);

  // Person mode state
  const [people, setPeople] = useState<PersonItem[]>([]);
  const [activeStage, setActiveStage] = useState<string>("");

  const [loading, setLoading] = useState(!preloaded);
  const [uploading, setUploading] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [busyWorkflowActionId, setBusyWorkflowActionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsEditing(false);
    setEditContent("");
    warmDmSplitRef.current = null;
    setShowFullLinkedInDraft(false);
  }, [activeIdx, workflowItemId, workflowId]);

  useEffect(() => {
    blockArtifactPollRef.current = isEditing || saving;
  }, [isEditing, saving]);

  // Upload featured image → strattegys, then update frontmatter
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Convert to base64 (chunk to avoid stack overflow)
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
      }
      const base64 = btoa(binary);

      // Upload to strattegys
      const uploadRes = await fetch("/api/crm/packages/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, data: base64 }),
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.ok) throw new Error(uploadData.error || "Upload failed");

      const imageUrl = uploadData.url;

      // Update the artifact frontmatter with the image URL
      const active = artifacts[activeIdx];
      if (active) {
        const updated = active.content.replace(
          /^(featuredImage:)\s*.*$/m,
          `$1 ${imageUrl}`
        );
        await fetch("/api/crm/artifacts/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactId: active.id, content: updated }),
        });
        setArtifacts(prev => prev.map((a, i) => i === activeIdx ? { ...a, content: updated } : a));
      }
    } catch (err) {
      console.error("[image upload]", err);
      alert("Image upload failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [artifacts, activeIdx]);

  const handleStartEdit = useCallback(() => {
    const a = artifacts[activeIdx];
    if (!a) return;
    const stageU = (a.stage || "").toUpperCase();
    const wantBody = linkedInDmBodyStages?.some((s) => s.toUpperCase() === stageU);
    if (wantBody) {
      const sp = splitWarmLinkedInDmArtifact(a.content);
      if (sp) {
        warmDmSplitRef.current = sp;
        setEditContent(sp.body);
        setIsEditing(true);
        return;
      }
    }
    warmDmSplitRef.current = null;
    setEditContent(a.content);
    setIsEditing(true);
  }, [artifacts, activeIdx, linkedInDmBodyStages]);

  const handleSaveEdit = useCallback(async () => {
    const a = artifacts[activeIdx];
    if (!a || saving) return;
    const split = warmDmSplitRef.current;
    const nextContent = split ? recomposeWarmLinkedInDmArtifact(split, editContent) : editContent;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/artifacts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: nextContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(typeof err.error === "string" ? err.error : "Save failed. Try again.");
        return;
      }
      setArtifacts((prev) =>
        prev.map((art, i) => (i === activeIdx ? { ...art, content: nextContent } : art))
      );
      warmDmSplitRef.current = null;
      setIsEditing(false);
    } catch {
      alert("Save failed. Check your connection and try again.");
    }
    setSaving(false);
  }, [artifacts, activeIdx, editContent, saving]);

  const handleCancelEdit = useCallback(() => {
    warmDmSplitRef.current = null;
    setIsEditing(false);
    setEditContent("");
  }, []);

  // Chat sidebar state
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const sendChatMessageDirect = useCallback(async (msg: string) => {
    if (!msg.trim() || chatSending) return;
    setChatMessages((prev) => [...prev, { role: "user", text: msg }]);
    setChatSending(true);
    try {
      const active = artifacts[activeIdx];
      const res = await fetch("/api/crm/artifact-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactId: active?.id,
          message: msg,
          currentContent: active?.content,
          agentId,
        }),
      });
      const data = await res.json();
      if (data.reply) {
        setChatMessages((prev) => [...prev, { role: "assistant", text: data.reply }]);
      }
      if (data.updatedContent && active) {
        // Update the artifact content in place
        setArtifacts((prev) =>
          prev.map((a, i) => (i === activeIdx ? { ...a, content: data.updatedContent } : a))
        );
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", text: "Failed to get a response. Try again." }]);
    }
    setChatSending(false);
  }, [chatSending, artifacts, activeIdx, agentId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (preloaded) return;
    if (!workflowId && !workflowItemId) return;

    if (usePeopleView && workflowId) {
      // Fetch people for this workflow — API returns title (name) and subtitle (job title)
      fetch(`/api/crm/workflow-items?workflowId=${workflowId}`)
        .then((r) => r.json())
        .then((data) => {
          const items: PersonItem[] = (data.items || []).map((it: Record<string, unknown>) => {
            const name = (it.title as string) || "Unknown";
            const parts = name.split(" ");
            return {
              itemId: it.id as string,
              stage: it.stage as string,
              firstName: parts[0] || "",
              lastName: parts.slice(1).join(" ") || "",
              jobTitle: (it.subtitle as string) || "",
              createdAt: (it.createdAt as string) || "",
            };
          });
          setPeople(items);
          const stages = [...new Set(items.map((p) => p.stage))];
          if (stages.length > 0) setActiveStage(stages[0]);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      // Fetch artifacts
      const params = new URLSearchParams();
      if (workflowItemId) params.set("workflowItemId", workflowItemId);
      else if (workflowId) params.set("workflowId", workflowId);

      fetch(`/api/crm/artifacts?${params}`)
        .then((r) => r.json())
        .then((data) => {
          const arts = sortArtifactsForTabs((data.artifacts || []) as Artifact[]);
          setArtifacts(arts);
          if (arts.length > 0) {
            setActiveIdx(arts.length - 1);
          } else {
            setActiveIdx(0);
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [workflowItemId, workflowId, preloaded, usePeopleView]);

  const selectedArtifactIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedArtifactIdRef.current = artifacts[activeIdx]?.id ?? null;
  }, [artifacts, activeIdx]);

  useEffect(() => {
    const ms = pollArtifactsMs && pollArtifactsMs > 0 ? pollArtifactsMs : 0;
    if (!ms || !workflowItemId || preloaded || usePeopleView) return;
    const params = new URLSearchParams();
    params.set("workflowItemId", workflowItemId);
    const url = `/api/crm/artifacts?${params}`;
    const tick = () => {
      if (blockArtifactPollRef.current) return;
      fetch(url, { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          if (blockArtifactPollRef.current) return;
          const arts = sortArtifactsForTabs((data.artifacts || []) as Artifact[]);
          const hold = selectedArtifactIdRef.current;
          setArtifacts((prev) => {
            if (artifactListContentEqual(prev, arts)) return prev;
            return arts;
          });
          if (hold) {
            const ni = arts.findIndex((a) => a.id === hold);
            if (ni >= 0) setActiveIdx(ni);
          }
        })
        .catch(() => {});
    };
    const id = window.setInterval(tick, ms);
    return () => clearInterval(id);
  }, [pollArtifactsMs, workflowItemId, preloaded, usePeopleView]);

  const lastFocusKeyRef = useRef<string>("__init__");
  useEffect(() => {
    lastFocusKeyRef.current = "__init__";
  }, [workflowItemId, workflowId]);

  useEffect(() => {
    if (!onActiveArtifactChange) return;
    if (usePeopleView) {
      if (lastFocusKeyRef.current !== "__people__") {
        lastFocusKeyRef.current = "__people__";
        onActiveArtifactChange(null);
      }
      return;
    }
    if (loading) return;
    const a = artifacts[activeIdx];
    if (!a) {
      if (lastFocusKeyRef.current !== "__empty__") {
        lastFocusKeyRef.current = "__empty__";
        onActiveArtifactChange(null);
      }
      return;
    }
    const label = artifactTabLabel(a);
    const key = `${a.stage}\0${label}`;
    if (key === lastFocusKeyRef.current) return;
    lastFocusKeyRef.current = key;
    onActiveArtifactChange({ stage: a.stage, label });
  }, [onActiveArtifactChange, usePeopleView, loading, artifacts, activeIdx]);

  const active = artifacts[activeIdx];

  const linkedInDmSplit =
    active && linkedInDmBodyStages?.length
      ? (() => {
          const u = (active.stage || "").toUpperCase();
          if (!linkedInDmBodyStages.some((s) => s.toUpperCase() === u)) return null;
          return splitWarmLinkedInDmArtifact(active.content);
        })()
      : null;
  const showLinkedInMessageFocus = Boolean(linkedInDmSplit);
  /** Same plain text Unipile send uses (see resolve + extractPlainDmFromDraftMarkdown). */
  const linkedInPlainSendPreview =
    showLinkedInMessageFocus && active
      ? extractPlainDmFromDraftMarkdown(active.content).trim()
      : "";

  const recomposedDraft =
    isEditing && warmDmSplitRef.current
      ? recomposeWarmLinkedInDmArtifact(warmDmSplitRef.current, editContent)
      : editContent;

  const hasUnsavedArtifactEdit =
    !usePeopleView &&
    isEditing &&
    !!active &&
    recomposedDraft !== active.content;

  // Person mode: group by stage
  const personStages = usePeopleView ? [...new Set(people.map((p) => p.stage))] : [];
  const filteredPeople = usePeopleView ? people.filter((p) => p.stage === activeStage) : [];

  const shell = (
    <div
      className={
        isInline
          ? "bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] flex flex-col shadow-sm overflow-hidden h-full min-h-0 w-full"
          : "bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] max-w-[95vw] max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
      }
      style={isInline ? undefined : { width: !usePeopleView && active ? 980 : 520 }}
    >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <svg
              className="shrink-0 mt-0.5 opacity-70"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {usePeopleView ? (
                <>
                  <circle cx="12" cy="7" r="4" />
                  <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                </>
              ) : (
                <>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </>
              )}
            </svg>
            <div className="min-w-0 flex flex-col gap-1">
              <span className="text-sm font-medium text-[var(--text-chat-body)]">
                {usePeopleView ? "People Pipeline" : (title || active?.name || "Artifacts")}
              </span>
              {headerDetail ? (
                <div className="min-w-0 text-[var(--text-tertiary)] [&_a]:text-[var(--text-secondary)] [&_a:hover]:text-[var(--text-primary)]">
                  {headerDetail}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {!usePeopleView && active && !isEditing && (
              <button
                onClick={handleStartEdit}
                className="text-[10px] px-2.5 py-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] transition-colors"
              >
                Edit
              </button>
            )}
            {isEditing && (
              <>
                <button
                  onClick={handleCancelEdit}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
            {/* Attach featured image */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-[10px] px-2.5 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors font-medium flex items-center gap-1"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              {uploading ? "Uploading..." : "Attach Image"}
            </button>
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
                  disabled={wfBusy || taskSubmitting || saving || hasUnsavedArtifactEdit}
                  onClick={async () => {
                    if (!window.confirm(a.confirmMessage)) return;
                    setBusyWorkflowActionId(a.id);
                    try {
                      await a.onConfirm();
                    } finally {
                      setBusyWorkflowActionId(null);
                    }
                  }}
                  className={`text-[10px] px-2.5 py-1 rounded font-medium border transition-colors disabled:opacity-50 disabled:pointer-events-none ${tone}`}
                >
                  {busyWorkflowActionId === a.id ? "…" : a.label}
                </button>
              );
            })}
            {onSubmitTask && (
              <button
                type="button"
                title={
                  hasUnsavedArtifactEdit
                    ? "Save your draft edits before submitting this task."
                    : undefined
                }
                disabled={taskSubmitting || saving || busyWorkflowActionId !== null || hasUnsavedArtifactEdit}
                onClick={async () => {
                  if (taskSubmitting || hasUnsavedArtifactEdit) return;
                  setTaskSubmitting(true);
                  try {
                    await onSubmitTask();
                    if (!isInline) onClose();
                  } finally {
                    setTaskSubmitting(false);
                  }
                }}
                className="text-[10px] px-3 py-1 rounded border border-[var(--accent-green)]/35 bg-[var(--accent-green)]/8 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-green)]/12 transition-colors font-medium disabled:opacity-50 disabled:pointer-events-none"
              >
                {taskSubmitting ? "Submitting…" : hasUnsavedArtifactEdit ? "Save to submit" : "Submit"}
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        {usePeopleView ? (
          personStages.length > 1 && (
            <div className="flex gap-1 px-5 py-2 border-b border-[var(--border-color)] overflow-x-auto shrink-0" style={{ scrollbarWidth: "none" }}>
              {personStages.map((stage) => {
                const count = people.filter((p) => p.stage === stage).length;
                return (
                  <button
                    key={stage}
                    onClick={() => setActiveStage(stage)}
                    className={`text-[10px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors shrink-0 border ${
                      stage === activeStage
                        ? "border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium"
                        : "border-transparent bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] font-medium"
                    }`}
                  >
                    {stage} ({count})
                  </button>
                );
              })}
            </div>
          )
        ) : (
          (alwaysShowArtifactTabs ? artifacts.length >= 1 : artifacts.length > 1) && (
            <div className="px-3 sm:px-5 py-2 border-b border-[var(--border-color)] shrink-0 min-w-0">
              <ArtifactTabScrollRow activeIndex={activeIdx} className="min-w-0">
                {artifacts.map((a, i) => {
                  const newestIdx = artifacts.length - 1;
                  const isNewest = i === newestIdx && artifacts.length > 1;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      data-artifact-tab-index={i}
                      onClick={() => setActiveIdx(i)}
                      className={`text-left text-[10px] px-2.5 py-1.5 rounded-lg transition-colors shrink-0 max-w-[180px] border ${
                        i === activeIdx
                          ? "border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium"
                          : isNewest
                            ? "border-[var(--text-tertiary)]/35 bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium"
                            : "border-transparent bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] font-medium"
                      }`}
                    >
                      {allWorkflowArtifacts ? (
                        <span className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[9px] uppercase tracking-wide opacity-80 truncate">{a.stage}</span>
                          <span className="font-medium leading-tight line-clamp-2 break-words whitespace-normal">
                            {a.name}
                          </span>
                        </span>
                      ) : (
                        <span className="whitespace-nowrap truncate block max-w-[220px]">
                          {artifactTabLabel(a)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </ArtifactTabScrollRow>
            </div>
          )
        )}

        {/* Content — artifact + chat (side or stacked when inline+bottom) */}
        <div
          className={`flex-1 min-h-0 ${chatBelow && !usePeopleView && active ? "flex flex-col" : "flex flex-row"}`}
        >
          {/* Artifact content */}
          <div
            className={`overflow-y-auto px-5 py-4 ${
              !usePeopleView && active && isInline && !chatBelow ? "flex-1 min-w-0 border-r border-[var(--border-color)]" : ""
            } ${chatBelow && !usePeopleView && active ? "flex-1 min-h-0 min-w-0 border-b border-[var(--border-color)]" : ""}`}
            style={
              chatBelow
                ? undefined
                : isInline
                  ? !usePeopleView && active
                    ? undefined
                    : { flex: 1 }
                  : !usePeopleView && active
                    ? { width: 620, flexShrink: 0, borderRight: "1px solid var(--border-color)" }
                    : { flex: 1 }
            }
          >
            {loading ? (
              <div className="text-center text-[var(--text-tertiary)] py-8">
                Loading...
              </div>
            ) : usePeopleView ? (
              filteredPeople.length === 0 ? (
                <div className="text-center text-[var(--text-tertiary)] py-8">
                  No people at this stage
                </div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]">
                      <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-medium">Name</th>
                      <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-medium">Title / Company</th>
                      <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-medium">Stage</th>
                      <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-medium">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPeople.map((p) => (
                      <tr key={p.itemId} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]">
                        <td className="py-2 px-2 text-[var(--text-chat-body)] font-medium">
                          {p.firstName} {p.lastName}
                        </td>
                        <td className="py-2 px-2 text-[var(--text-secondary)]">
                          {p.jobTitle}
                        </td>
                        <td className="py-2 px-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                            {p.stage}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-[var(--text-tertiary)]">
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : !active ? (
              <div className="text-center text-[var(--text-tertiary)] py-8">
                No artifacts found
              </div>
            ) : isEditing ? (
              <div className="flex flex-col gap-2 min-h-0 h-full">
                {warmDmSplitRef.current ? (
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)] shrink-0">
                    Edit message only (research block unchanged until you save)
                  </p>
                ) : null}
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full flex-1 min-h-[200px] bg-[var(--bg-primary)]/40 text-[var(--text-chat-body)] text-sm leading-relaxed border border-[var(--border-color)] rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--border-color)] resize-y placeholder:text-[var(--text-tertiary)]"
                  autoFocus
                />
              </div>
            ) : showLinkedInMessageFocus && linkedInDmSplit ? (
              <div className="space-y-3 min-h-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  Exact message sent on LinkedIn (plain text)
                </p>
                <div className="text-[var(--text-chat-body)] text-sm leading-relaxed whitespace-pre-wrap rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/35 px-3 py-3">
                  {linkedInPlainSendPreview ||
                    linkedInDmSplit.body.replace(/\*\*([^*]+)\*\*/g, "$1").trim() ||
                    "—"}
                </div>
                <button
                  type="button"
                  onClick={() => setShowFullLinkedInDraft((v) => !v)}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] border border-[var(--border-color)]"
                >
                  {showFullLinkedInDraft
                    ? "Hide full draft"
                    : "Show full draft (research, rationale, Tim notes)"}
                </button>
                {showFullLinkedInDraft ? (
                  <div className="max-w-none border-t border-[var(--border-color)] pt-4 text-[var(--text-chat-body)]">
                    <MarkdownRenderer content={active.content} />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="max-w-none text-[var(--text-chat-body)]">
                <MarkdownRenderer content={active.content} />
              </div>
            )}
          </div>

          {/* Agent chat sidebar (optional — Tim work queue uses main chat) */}
          {showArtifactChat && !usePeopleView && active && (
            <div
              className={`flex flex-col shrink-0 ${
                chatBelow
                  ? "w-full min-h-[200px] max-h-[min(40vh,360px)] border-t border-[var(--border-color)] bg-[var(--bg-primary)]/30"
                  : isInline
                    ? "w-[min(360px,38%)] min-w-[260px] border-l border-[var(--border-color)]"
                    : ""
              }`}
              style={chatBelow || isInline ? undefined : { width: 360 }}
            >
              {/* Agent header */}
              {(() => {
                const agent = AGENT_INFO[agentId || "ghost"] || AGENT_INFO.ghost;
                return (
                  <div className="p-3 border-b border-[var(--border-color)] flex items-center gap-3.5">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0 border-2 bg-[var(--bg-primary)] text-[var(--text-chat-body)]"
                      style={{ borderColor: agent.color }}
                    >
                      {agent.name[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--text-chat-body)]">{agent.name}</div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">{agent.role}</div>
                    </div>
                  </div>
                );
              })()}
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {chatMessages.length === 0 && (
                  <div className="text-center text-[var(--text-tertiary)] text-[11px] py-6">
                    Ask {AGENT_INFO[agentId || "ghost"]?.name || "Ghost"} to refine this document.
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`text-[11px] leading-relaxed px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] ${
                      m.role === "user"
                        ? "ml-auto bg-[var(--bg-secondary)] text-[var(--text-chat-body)]"
                        : "mr-auto bg-[var(--bg-primary)] text-[var(--text-chat-body)]"
                    }`}
                    style={{ maxWidth: "90%" }}
                  >
                    {m.text}
                  </div>
                ))}
                {chatSending && (
                  <div className="text-[11px] text-[var(--text-tertiary)] px-2.5 py-1.5">Thinking...</div>
                )}
                <div ref={chatEndRef} />
              </div>
              {/* Input — shared ChatInput component with push-to-talk */}
              <ChatInput
                onSend={sendChatMessageDirect}
                disabled={chatSending}
                isLoading={chatSending}
                placeholder={`Ask ${AGENT_INFO[agentId || "ghost"]?.name || "Ghost"} to make changes...`}
                agentName={AGENT_INFO[agentId || "ghost"]?.name || "Ghost"}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        {usePeopleView ? (
          <div className="px-5 py-2.5 border-t border-[var(--border-color)] text-[10px] text-[var(--text-tertiary)]">
            {people.length} total people across {personStages.length} stages
          </div>
        ) : active && showArtifactFooter ? (
          <div className="px-5 py-2.5 border-t border-[var(--border-color)] flex items-center justify-between gap-2 text-[10px] text-[var(--text-tertiary)] flex-wrap">
            <span>
              Created: {new Date(active.createdAt).toLocaleString()}
              {allWorkflowArtifacts && active.workflowItemId ? (
                <span className="text-[var(--text-tertiary)]/80"> · item {active.workflowItemId.slice(0, 8)}…</span>
              ) : null}
            </span>
            <span
              className={`shrink-0 text-right min-w-0 ${allWorkflowArtifacts ? "flex flex-col items-end gap-0.5" : "uppercase"}`}
            >
              {allWorkflowArtifacts ? (
                <>
                  <span className="uppercase text-[9px] opacity-80">{active.stage}</span>
                  <span className="normal-case">{active.type}</span>
                </>
              ) : (
                <span className="uppercase">
                  {active.stage} · {active.type}
                </span>
              )}
            </span>
          </div>
        ) : null}
      </div>
  );

  if (isInline) {
    return <div className="flex flex-col h-full min-h-0 w-full min-w-0">{shell}</div>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {shell}
    </div>
  );
}

/** Tab label for standard single-workflow artifact strips (matches testing flows). */
export function artifactTabLabel(a: { stage: string; name: string }): string {
  const s = (a.stage || "").toUpperCase();
  if (s === "PACKAGE_BRIEF") return "Package raise";
  if (s === "RESEARCHING") return "Research";
  if (s === "CAMPAIGN_SPEC") return "Campaign spec";
  if (s === "AWAITING_CONTACT") return "Contact notes";
  if (s === "IDEA") return "Idea";
  if (s === "MESSAGE_DRAFT") return "Message draft";
  if (s === "MESSAGED") return "Messaged";
  if (s === "REPLY_DRAFT") return "Reply draft";
  return a.name?.trim() || a.stage || "Artifact";
}

/** Oldest left → newest right (creation order). */
function sortArtifactsForTabs<T extends { createdAt: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/** Avoid setArtifacts when poll returns identical bodies — keeps text selection stable. */
function artifactListContentEqual(a: Artifact[], b: Artifact[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!y || x.id !== y.id || x.content !== y.content || x.stage !== y.stage) return false;
  }
  return true;
}

/**
 * Simple markdown renderer — converts basic markdown to HTML.
 * Memoized so parent re-renders (e.g. queue polling) do not rewrite innerHTML and kill copy/select.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: {
  content: string;
}) {
  const html = markdownToHtml(content);
  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      className="text-[13px] leading-relaxed text-[var(--text-chat-body)] select-text cursor-text [&_strong]:text-[var(--text-primary)] [&_strong]:font-semibold"
      style={{ lineHeight: "1.7" }}
    />
  );
});

function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre style="background:var(--bg-primary);padding:12px;border-radius:8px;overflow-x:auto;margin:12px 0"><code>${code.trim()}</code></pre>`;
  });

  html = html.replace(/^---+$/gm, '<hr style="border-color:var(--border-color);margin:16px 0"/>');
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;margin:16px 0 8px;color:var(--text-primary)">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:20px 0 8px;color:var(--text-primary)">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:700;margin:20px 0 10px;color:var(--accent-green)">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-primary);padding:2px 6px;border-radius:4px;font-size:12px">$1</code>');
  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--text-secondary);text-decoration:underline;text-underline-offset:2px">$1</a>');
  // Bare URLs
  html = html.replace(/(?<![">])(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--text-secondary);text-decoration:underline;text-underline-offset:2px">$1</a>');
  html = html.replace(/^- (.+)$/gm, '<li style="margin:4px 0;padding-left:4px">$1</li>');
  html = html.replace(/^• (.+)$/gm, '<li style="margin:4px 0;padding-left:4px">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0;padding-left:4px">$1</li>');
  html = html.replace(/^→ (.+)$/gm, '<li style="margin:4px 0;padding-left:4px;list-style:none">→ $1</li>');
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul style="margin:8px 0;padding-left:20px">$1</ul>');
  html = html.replace(/^(?!<[huplo]|<\/|<hr|<pre|<code|$)(.+)$/gm, '<p style="margin:6px 0">$1</p>');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (line) => {
    if (line.match(/^\|[\s-:|]+\|$/)) return ""; // separator row
    const cells = line.split("|").filter(Boolean).map((c) => c.trim());
    const tds = cells.map((c) => `<td style="padding:6px 10px;border-bottom:1px solid var(--border-color)">${c}</td>`).join("");
    return `<tr>${tds}</tr>`;
  });
  html = html.replace(/((?:<tr>.*?<\/tr>\n?)+)/g, '<table style="width:100%;border-collapse:collapse;margin:12px 0">$1</table>');

  return html;
}
