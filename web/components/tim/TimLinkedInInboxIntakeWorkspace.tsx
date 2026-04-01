"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MarkdownRenderer, artifactTabLabel } from "@/components/shared/ArtifactViewer";
import { panelBus } from "@/lib/events";
import TimMoveToWorkflow, { type TimMoveSelection } from "./TimMoveToWorkflow";

type UnipileThreadLine = { at: string; direction: "outbound" | "inbound"; body: string };

function normalizeUnipileThreadMessages(raw: unknown): UnipileThreadLine[] {
  if (!Array.isArray(raw)) return [];
  const out: UnipileThreadLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const body =
      (typeof o.body === "string" && o.body) ||
      (typeof o.text === "string" && o.text) ||
      (typeof o.message === "string" && o.message) ||
      "";
    const trimmed = body.trim();
    if (!trimmed) continue;
    const at =
      (typeof o.at === "string" && o.at) ||
      (typeof o.createdAt === "string" && o.createdAt) ||
      (typeof o.timestamp === "string" && o.timestamp) ||
      new Date().toISOString();
    const dirRaw = o.direction;
    const direction: "outbound" | "inbound" =
      dirRaw === "outbound" || dirRaw === "inbound" ? dirRaw : "inbound";
    out.push({ at, direction, body: trimmed });
  }
  return out;
}

const REPLY_TAB = "__reply__";
const PROFILE_ARTIFACT_NAME = "CRM: contact profile";
const DRAFT_ARTIFACT_NAME = "LinkedIn: initial reply draft";

type ArtifactRow = { id: string; stage: string; name: string; content: string; createdAt: string };

export type LinkedInInboxIntakeTask = {
  itemId: string;
  workflowId: string;
  workflowName: string;
  stage: string;
  stageLabel: string;
  humanAction: string;
  workflowType: string;
  sourceId: string;
};

function sortArtifactsByCreatedAt(list: ArtifactRow[]): ArtifactRow[] {
  return [...list].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function formatPersonProfileMarkdown(p: {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  city: string | null;
  companyName: string | null;
}): string {
  const name = [p.firstName?.trim(), p.lastName?.trim()].filter(Boolean).join(" ") || "—";
  const lines = [
    "## Contact profile",
    "",
    `**Name:** ${name}`,
    `**Company:** ${p.companyName?.trim() || "—"}`,
    `**Title:** ${p.jobTitle?.trim() || "—"}`,
    `**City:** ${p.city?.trim() || "—"}`,
  ];
  const li = p.linkedinUrl?.trim();
  if (li) lines.push("", `**LinkedIn:** [Profile](${li})`);
  else lines.push("", "**LinkedIn:** —");
  return lines.join("\n");
}

interface TimLinkedInInboxIntakeWorkspaceProps {
  task: LinkedInInboxIntakeTask;
  resolving: boolean;
  /** Approve / terminal resolve — optional reply notes stored as artifact when non-empty */
  onSubmitApprove: (notes: string) => Promise<void>;
  onMoved?: () => void;
  headerDetail?: ReactNode;
  titleAccessory?: ReactNode;
}

export default function TimLinkedInInboxIntakeWorkspace({
  task,
  resolving,
  onSubmitApprove,
  onMoved,
  headerDetail,
  titleAccessory,
}: TimLinkedInInboxIntakeWorkspaceProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(REPLY_TAB);
  const [replyText, setReplyText] = useState("");
  const [draftArtifactId, setDraftArtifactId] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [unipileLines, setUnipileLines] = useState<UnipileThreadLine[]>([]);
  const [unipileLoading, setUnipileLoading] = useState(false);
  const [unipileError, setUnipileError] = useState<string | null>(null);
  const [unipileScannedChats, setUnipileScannedChats] = useState(0);
  const [unipileResolution, setUnipileResolution] = useState<
    "inbound_webhook_chat" | "attendee_chats" | "full_scan" | null
  >(null);
  const [unipileEmptyAfterFetch, setUnipileEmptyAfterFetch] = useState(false);
  const [unipileCrmHint, setUnipileCrmHint] = useState<string | null>(null);
  /** Last non-empty reply text successfully saved to the draft artifact (must match current textarea to allow Submit). */
  const [savedReplyFingerprint, setSavedReplyFingerprint] = useState<string | null>(null);
  const [moveSelection, setMoveSelection] = useState<TimMoveSelection>({ workflowId: "", stageKey: "" });
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const profilePostInFlightRef = useRef(false);
  const prevItemIdForDraftRef = useRef<string | null>(null);
  /** Supersede in-flight Unipile fetches (Strict Mode double effect, rapid Refresh clicks). */
  const unipileFetchGenRef = useRef(0);

  const refetchArtifacts = useCallback(async () => {
    const r = await fetch(`/api/crm/artifacts?workflowItemId=${encodeURIComponent(task.itemId)}`, {
      credentials: "include",
    });
    const data = (await r.json().catch(() => ({}))) as { artifacts?: ArtifactRow[] };
    setArtifacts(sortArtifactsByCreatedAt((data.artifacts || []) as ArtifactRow[]));
  }, [task.itemId]);

  useEffect(() => {
    setActiveTab(REPLY_TAB);
    setReplyText("");
    setDraftArtifactId(null);
    setDraftErr(null);
    profilePostInFlightRef.current = false;
    prevItemIdForDraftRef.current = null;
    setUnipileLines([]);
    setUnipileError(null);
    setUnipileScannedChats(0);
    setUnipileResolution(null);
    setUnipileEmptyAfterFetch(false);
    setUnipileCrmHint(null);
    setUnipileLoading(false);
    setSavedReplyFingerprint(null);
    setMoveSelection({ workflowId: "", stageKey: "" });
    setMoveDialogOpen(false);
  }, [task.itemId]);

  const handleMoveSelectionChange = useCallback((sel: TimMoveSelection) => {
    setMoveSelection(sel);
  }, []);

  const draftSavedAndInSync =
    Boolean(savedReplyFingerprint && savedReplyFingerprint.length > 0) &&
    replyText.trim() === savedReplyFingerprint;
  const moveTargetChosen = Boolean(moveSelection.workflowId && moveSelection.stageKey);
  const canSubmitIntake = draftSavedAndInSync || moveTargetChosen;
  const submitDisabledReason =
    'Save a non-empty reply draft, or open "Target workflow…" and choose a workflow and board stage.';

  const closeMoveDialog = useCallback(() => {
    setMoveDialogOpen(false);
    setMoveSelection({ workflowId: "", stageKey: "" });
  }, []);

  useEffect(() => {
    if (!moveDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMoveDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveDialogOpen, closeMoveDialog]);

  const loadUnipileThread = useCallback(() => {
    const gen = ++unipileFetchGenRef.current;
    setUnipileLoading(true);
    setUnipileError(null);
    setUnipileEmptyAfterFetch(false);
    setUnipileResolution(null);

    if (!task.sourceId?.trim()) {
      if (gen === unipileFetchGenRef.current) {
        setUnipileLines([]);
        setUnipileError(
          "This queue row has no CRM person id, so LinkedIn thread cannot load. The item may need to be linked to a person in the workflow."
        );
        setUnipileEmptyAfterFetch(true);
        setUnipileLoading(false);
      }
      return;
    }

    void (async () => {
      try {
        const r = await fetch(
          `/api/crm/person/linkedin-thread?personId=${encodeURIComponent(task.sourceId)}&workflowItemId=${encodeURIComponent(task.itemId)}`,
          { credentials: "include", cache: "no-store" }
        );
        const rawText = await r.text();
        let d: Record<string, unknown> = {};
        try {
          d = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          if (gen !== unipileFetchGenRef.current) return;
          setUnipileLines([]);
          setUnipileError(r.ok ? "Bad response from server" : `HTTP ${r.status}`);
          setUnipileEmptyAfterFetch(true);
          return;
        }

        if (gen !== unipileFetchGenRef.current) return;

        const crmSynced = d.personCrmSynced === true;
        if (crmSynced) {
          setUnipileCrmHint(
            "Contact profile was updated from LinkedIn (name, title, company, URL). The queue is refreshing so card labels stay in sync."
          );
          panelBus.emit("workflow_items");
          panelBus.emit("dashboard_sync");
        } else {
          setUnipileCrmHint(null);
        }

        const scanned =
          typeof d.scannedChats === "number" ? d.scannedChats : Number(d.scannedChats) || 0;
        setUnipileScannedChats(scanned);

        if (!r.ok) {
          setUnipileLines([]);
          setUnipileError(typeof d.error === "string" ? d.error : `HTTP ${r.status}`);
          setUnipileEmptyAfterFetch(true);
          return;
        }

        if (d.ok === false) {
          setUnipileLines([]);
          setUnipileError(
            typeof d.error === "string" ? d.error : "Could not load LinkedIn thread for this contact"
          );
          setUnipileEmptyAfterFetch(true);
          return;
        }

        const lines = normalizeUnipileThreadMessages(d.messages);
        setUnipileLines(lines);
        setUnipileError(null);
        setUnipileResolution(
          d.resolution === "full_scan"
            ? "full_scan"
            : d.resolution === "attendee_chats"
              ? "attendee_chats"
              : d.resolution === "inbound_webhook_chat"
                ? "inbound_webhook_chat"
                : null
        );
        setUnipileEmptyAfterFetch(lines.length === 0);
      } catch (err) {
        if (gen !== unipileFetchGenRef.current) return;
        setUnipileLines([]);
        const msg = err instanceof Error ? err.message : "Could not load LinkedIn thread";
        setUnipileError(msg);
        setUnipileEmptyAfterFetch(true);
      } finally {
        if (gen === unipileFetchGenRef.current) setUnipileLoading(false);
      }
    })();
  }, [task.sourceId, task.itemId]);

  useEffect(() => {
    loadUnipileThread();
    return () => {
      unipileFetchGenRef.current += 1;
    };
  }, [task.itemId, task.sourceId, loadUnipileThread]);

  /** Avoid a stuck disabled Refresh if a superseded fetch never cleared loading (Strict Mode / fast tab switch). */
  useEffect(() => {
    if (!unipileLoading) return;
    const t = window.setTimeout(() => setUnipileLoading(false), 125_000);
    return () => window.clearTimeout(t);
  }, [unipileLoading]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setArtifacts([]);
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

  useEffect(() => {
    if (loading) return;
    const drafts = artifacts
      .filter((a) => a.name === DRAFT_ARTIFACT_NAME)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = drafts[0];
    setDraftArtifactId(latest?.id ?? null);
    if (prevItemIdForDraftRef.current !== task.itemId) {
      prevItemIdForDraftRef.current = task.itemId;
      const content = latest?.content ?? "";
      setReplyText(content);
      const trimmed = content.trim();
      setSavedReplyFingerprint(trimmed.length > 0 ? trimmed : null);
    }
  }, [loading, artifacts, task.itemId]);

  useEffect(() => {
    if (loading || !task.sourceId) return;
    if (artifacts.some((a) => a.name === PROFILE_ARTIFACT_NAME)) return;
    if (profilePostInFlightRef.current) return;
    profilePostInFlightRef.current = true;
    void (async () => {
      try {
        const pr = await fetch(`/api/crm/person?id=${encodeURIComponent(task.sourceId)}`, {
          credentials: "include",
        });
        const pd = (await pr.json().catch(() => ({}))) as {
          person?: Parameters<typeof formatPersonProfileMarkdown>[0];
          error?: string;
        };
        if (!pr.ok || !pd.person) return;
        const content = formatPersonProfileMarkdown(pd.person);
        await fetch("/api/crm/artifacts", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowItemId: task.itemId,
            workflowId: task.workflowId,
            stage: task.stage,
            name: PROFILE_ARTIFACT_NAME,
            type: "markdown",
            content,
          }),
        });
        await refetchArtifacts();
      } catch {
        /* ignore */
      } finally {
        profilePostInFlightRef.current = false;
      }
    })();
  }, [loading, task.itemId, task.workflowId, task.stage, task.sourceId, artifacts, refetchArtifacts]);

  const historyArtifacts = useMemo(() => {
    return [...artifacts]
      .filter((a) => a.name !== DRAFT_ARTIFACT_NAME)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [artifacts]);

  /** Newest first — inbound snapshots read like a thread (excludes profile + reply draft). */
  const messageHistoryArtifacts = useMemo(() => {
    return [...artifacts]
      .filter((a) => a.name !== PROFILE_ARTIFACT_NAME && a.name !== DRAFT_ARTIFACT_NAME)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [artifacts]);

  /** Unipile lines are oldest→newest from API; show newest at top in the UI. */
  const unipileLinesNewestFirst = useMemo(
    () =>
      [...unipileLines].sort(
        (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
      ),
    [unipileLines]
  );

  function threadEntryTitle(a: ArtifactRow): string {
    if (a.name === "LinkedIn: connection accepted") return "Connection accepted";
    if (a.name === "LinkedIn: inbound message") return "Inbound message";
    return artifactTabLabel(a);
  }

  const artifactsNewestFirst = historyArtifacts;

  const activeArtifact = activeTab !== REPLY_TAB ? artifacts.find((a) => a.id === activeTab) : null;

  const historyRailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = historyRailRef.current;
    if (!root) return;
    const key = activeTab === REPLY_TAB ? REPLY_TAB : activeTab;
    const el = root.querySelector(`[data-inbox-history="${key}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeTab]);

  const historyButtonClass = (selected: boolean) =>
    `w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
      selected
        ? "border-[var(--accent-green)]/55 bg-[var(--accent-green)]/14 text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--accent-green)]/35"
        : "border-[var(--border-color)]/60 bg-[var(--bg-secondary)]/80 text-[var(--text-secondary)] hover:border-[var(--border-color)] hover:bg-[var(--bg-secondary)]"
    }`;

  const saveDraft = async () => {
    setDraftBusy(true);
    setDraftErr(null);
    try {
      const body = replyText;
      if (draftArtifactId) {
        const r = await fetch("/api/crm/artifacts", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: draftArtifactId, content: body }),
        });
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error || `HTTP ${r.status}`);
        }
      } else {
        const r = await fetch("/api/crm/artifacts", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowItemId: task.itemId,
            workflowId: task.workflowId,
            stage: task.stage,
            name: DRAFT_ARTIFACT_NAME,
            type: "markdown",
            content: body,
          }),
        });
        const d = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        if (d.id) setDraftArtifactId(d.id);
      }
      const trimmed = body.trim();
      setSavedReplyFingerprint(trimmed.length > 0 ? trimmed : null);
      await refetchArtifacts();
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setDraftBusy(false);
    }
  };

  const unipilePanel = (
    <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-3">
      <section aria-label="LinkedIn thread from Unipile">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              LinkedIn thread (Unipile)
            </p>
            <p className="mt-0.5 text-[9px] leading-snug text-[var(--text-tertiary)]">
              Stays on screen when you open <strong className="font-medium text-[var(--text-secondary)]">History</strong>{" "}
              tabs — Refresh always runs the same request.
            </p>
          </div>
          <button
            type="button"
            aria-busy={unipileLoading}
            title={
              unipileLoading
                ? "Request in progress — you can click again to retry"
                : "Reload thread from Unipile"
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void loadUnipileThread();
            }}
            className={`pointer-events-auto shrink-0 text-[10px] font-medium rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${unipileLoading ? "opacity-70" : ""}`}
          >
            {unipileLoading ? "Loading…" : "Refresh from LinkedIn"}
          </button>
        </div>
        {unipileCrmHint ? (
          <p className="mt-1.5 text-[10px] leading-snug text-[var(--accent-green)]">{unipileCrmHint}</p>
        ) : null}
        {unipileLoading && unipileLines.length === 0 ? (
          <p className="text-[11px] text-[var(--text-tertiary)]">Loading conversation…</p>
        ) : null}
        {unipileError && !unipileLoading ? (
          <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">{unipileError}</p>
        ) : null}
        {unipileEmptyAfterFetch && !unipileLoading && unipileLines.length === 0 && !unipileError ? (
          <p className="text-[11px] leading-snug text-[var(--text-tertiary)]">
            {unipileResolution === "inbound_webhook_chat"
              ? "Unipile returned no messages for the chat id from this inbound snapshot (new thread, or API returned an empty page). Try Refresh after LinkedIn sync."
              : unipileResolution === "attendee_chats"
                ? "Unipile did not return a 1:1 chat for this LinkedIn member id (or the thread has no text yet). Try Refresh after LinkedIn sync, or confirm linkedinProviderId matches their ACoA id."
                : `No matching 1:1 chat after scanning ${unipileScannedChats || "many"} recent conversations. Older threads may sit outside the scan — use Refresh after new activity, or ask dev to raise scan depth.`}
          </p>
        ) : null}
        {unipileLines.length > 0 ? (
          <ul className="mt-2 flex max-h-[min(22rem,42vh)] flex-col gap-2 overflow-y-auto pr-0.5">
            {unipileLinesNewestFirst.map((ln, idx) => (
              <li
                key={`${ln.at}-${idx}`}
                className="rounded-md border border-[var(--border-color)]/70 bg-[var(--bg-primary)]/90 px-2.5 py-2"
              >
                <p className="text-[9px] text-[var(--text-tertiary)]">
                  {ln.at
                    ? new Date(ln.at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}{" "}
                  <span className="font-medium text-[var(--text-secondary)]">
                    · {ln.direction === "outbound" ? "You" : "Them"}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-snug text-[var(--text-chat-body)]">
                  {ln.body}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-sm">
      <div className="shrink-0 border-b border-[var(--border-color)]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-2.5">
          <div className="flex min-w-0 min-h-[2rem] flex-1 items-center gap-3">
            <svg
              className="shrink-0 opacity-70"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-0 text-sm font-medium leading-snug text-[var(--text-chat-body)]">
                {task.workflowName}
              </span>
              {titleAccessory ? <span className="min-w-0 shrink">{titleAccessory}</span> : null}
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={draftBusy}
              onClick={() => void saveDraft()}
              title={draftErr ?? undefined}
              className="shrink-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {draftBusy ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => setMoveDialogOpen(true)}
              className="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Target workflow…
            </button>
            <button
              type="button"
              disabled={resolving || !canSubmitIntake}
              title={!canSubmitIntake ? submitDisabledReason : undefined}
              onClick={() => void onSubmitApprove(replyText.trim())}
              className="shrink-0 rounded border border-[var(--accent-green)]/35 bg-[var(--accent-green)]/8 px-3 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-green)]/12 hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-50"
            >
              {resolving ? "Submitting…" : "Submit"}
            </button>
            {draftErr ? (
              <span className="max-w-[10rem] truncate text-[10px] text-amber-600 dark:text-amber-400 sm:max-w-[14rem]" title={draftErr}>
                {draftErr}
              </span>
            ) : null}
          </div>
        </div>

        {moveDialogOpen ? (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            role="presentation"
            onClick={closeMoveDialog}
          >
            <div className="absolute inset-0 bg-black/50" aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="tim-move-workflow-title"
              className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3">
                <h2 id="tim-move-workflow-title" className="text-sm font-semibold text-[var(--text-primary)]">
                  Target workflow & board
                </h2>
                <button
                  type="button"
                  onClick={closeMoveDialog}
                  className="shrink-0 rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  aria-label="Close dialog"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="max-h-[min(70vh,28rem)] overflow-y-auto px-4 py-3">
                <p className="mb-3 text-[10px] leading-snug text-[var(--text-tertiary)]">
                  Add this person to an active Tim package pipeline and remove this intake row from the queue.
                </p>
                <TimMoveToWorkflow
                  variant="dialog"
                  personId={task.sourceId}
                  intakeItemId={task.itemId}
                  selectionResetKey={task.itemId}
                  onSelectionChange={handleMoveSelectionChange}
                  onMoved={() => {
                    closeMoveDialog();
                    onMoved?.();
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

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
            {activeTab === REPLY_TAB ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="shrink-0 space-y-2 px-4 pt-4">
                  <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/85 p-3 shadow-sm">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                      Initial reply (optional)
                    </label>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Short draft or leave blank…"
                      rows={3}
                      className="min-h-[4.5rem] max-h-[7rem] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-2 text-[12px] leading-snug text-[var(--text-chat-body)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-color)] focus:outline-none"
                    />
                  </div>
                </div>

                {unipilePanel}

                <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50">
                    <div className="shrink-0 border-b border-[var(--border-color)]/70 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                        Queue snapshots (CRM)
                      </p>
                      <p className="mt-0.5 text-[9px] leading-snug text-[var(--text-tertiary)]">
                        Inbound webhook copies and notes for this row. Live Unipile thread is in the panel above. Open{" "}
                        <strong className="font-medium text-[var(--text-secondary)]">Contact profile</strong> in History
                        for CRM fields.
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-2">
                      <section aria-label="CRM artifacts for this queue item">
                        {loading ? (
                          <p className="text-[11px] text-[var(--text-tertiary)]">Loading artifacts…</p>
                        ) : messageHistoryArtifacts.length === 0 ? (
                          <p className="text-[11px] leading-snug text-[var(--text-tertiary)]">
                            No artifacts on this row yet (webhook intake, your submits, etc.).
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-4">
                            {messageHistoryArtifacts.map((a) => (
                              <li
                                key={a.id}
                                className="border-b border-[var(--border-color)]/60 pb-4 last:border-b-0 last:pb-0"
                              >
                                <p className="mb-1.5 text-[9px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                                  {a.createdAt
                                    ? new Date(a.createdAt).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                      })
                                    : "—"}{" "}
                                  <span className="normal-case tracking-normal text-[var(--text-secondary)]">
                                    · {threadEntryTitle(a)}
                                  </span>
                                </p>
                                <div className="max-w-none text-[12px] text-[var(--text-chat-body)] [&_p]:my-1 [&_ul]:my-1">
                                  <MarkdownRenderer content={a.content} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>
                  </div>
                </div>

                {task.humanAction ? (
                  <p className="shrink-0 px-4 pb-3 text-[11px] leading-snug text-[var(--text-chat-body)]">
                    <span className="text-[var(--text-tertiary)]">Task: </span>
                    {task.humanAction}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                {unipilePanel}
                {loading ? (
                  <div className="p-8 text-center text-sm text-[var(--text-tertiary)]">Loading…</div>
                ) : activeArtifact ? (
                  <div className="min-h-0 max-w-none p-4 text-[var(--text-chat-body)]">
                    <MarkdownRenderer content={activeArtifact.content} />
                  </div>
                ) : (
                  <div className="p-8 text-center text-sm text-[var(--text-tertiary)]">No artifact</div>
                )}
              </>
            )}
          </div>
        </div>

        <aside
          className="flex min-h-0 w-[min(13.5rem,32vw)] shrink-0 flex-col bg-[var(--bg-primary)]/25"
          aria-label="Message and artifact history"
        >
          <div className="shrink-0 border-b border-[var(--border-color)] px-2.5 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              History
            </p>
            <p className="mt-0.5 text-[8px] leading-snug text-[var(--text-tertiary)]">
              Reply box · contact · inbound artifacts
            </p>
          </div>
          <div ref={historyRailRef} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
            <button
              type="button"
              data-inbox-history={REPLY_TAB}
              onClick={() => setActiveTab(REPLY_TAB)}
              className={historyButtonClass(activeTab === REPLY_TAB)}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[8px] font-medium uppercase tracking-wide opacity-85">
                  Composer
                </span>
                <span className="text-[10px] font-medium leading-snug">Reply &amp; workflow</span>
              </span>
            </button>
            {artifactsNewestFirst.map((a) => (
              <button
                key={a.id}
                type="button"
                data-inbox-history={a.id}
                onClick={() => setActiveTab(a.id)}
                className={historyButtonClass(activeTab === a.id)}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[8px] font-medium uppercase tracking-wide opacity-85">
                    {a.stage}
                  </span>
                  <span className="line-clamp-2 break-words text-[10px] font-medium leading-snug">
                    {a.name === PROFILE_ARTIFACT_NAME ? "Contact profile" : artifactTabLabel(a)}
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
