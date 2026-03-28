"use client";

import { useCallback, useEffect, useState } from "react";
import { parsePersonLinkedInFields } from "@/lib/linkedin-person-identity";

type InsightPerson = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  linkedinUrl: string | null;
  linkedinProviderId: string | null;
  companyName: string | null;
  city: string | null;
};

type InsightEvent = {
  kind: "artifact" | "note" | "workflow_item";
  at: string;
  title: string;
  detail?: string;
  workflowName?: string | null;
  workflowItemId?: string | null;
  stage?: string | null;
};

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function kindLabel(k: InsightEvent["kind"]): string {
  if (k === "artifact") return "Artifact";
  if (k === "note") return "Note";
  return "Workflow";
}

function kindBadgeClass(k: InsightEvent["kind"]): string {
  if (k === "artifact")
    return "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]";
  if (k === "note")
    return "border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-chat-body)]";
  return "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]";
}

export default function TimContactInspectModal({
  personId,
  onClose,
}: {
  personId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<InsightPerson | null>(null);
  const [events, setEvents] = useState<InsightEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/crm/person/contact-insight?personId=${encodeURIComponent(personId)}`,
        { credentials: "include" }
      );
      const data = (await r.json().catch(() => ({}))) as {
        error?: string;
        person?: InsightPerson;
        events?: InsightEvent[];
      };
      if (!r.ok) {
        setError(typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
        setPerson(null);
        setEvents([]);
        return;
      }
      setPerson(data.person ?? null);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setError("Network error");
      setPerson(null);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fullName = person
    ? [person.firstName, person.lastName].filter(Boolean).join(" ").trim() || "Contact"
    : "";
  const li = person
    ? parsePersonLinkedInFields(person.linkedinUrl, person.linkedinProviderId)
    : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-8 bg-black/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tim-contact-inspect-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[min(60vw,calc(100vw-2rem))] max-h-[min(70vh,calc(100vh-2rem))] flex flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <h2
            id="tim-contact-inspect-title"
            className="text-base sm:text-lg font-semibold text-[var(--text-primary)] truncate"
          >
            Contact insight
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-[var(--text-tertiary)] px-5 sm:px-6 py-10 text-center">Loading…</p>
          ) : error ? (
            <p className="text-sm text-[var(--text-secondary)] px-5 sm:px-6 py-10 text-center">{error}</p>
          ) : person ? (
            <>
              <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-[var(--border-color)]/80 space-y-2.5">
                <p className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)] leading-tight">
                  {fullName}
                </p>
                {person.jobTitle?.trim() ? (
                  <p className="text-sm sm:text-base text-[var(--text-chat-body)] leading-snug">
                    {person.jobTitle.trim()}
                  </p>
                ) : null}
                {person.companyName?.trim() ? (
                  <p className="text-sm text-[var(--text-secondary)] leading-snug">{person.companyName.trim()}</p>
                ) : null}
                {person.city?.trim() ? (
                  <p className="text-xs text-[var(--text-tertiary)]">{person.city.trim()}</p>
                ) : null}
                <dl className="grid grid-cols-[6.5rem_1fr] sm:grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-xs sm:text-sm pt-2">
                  {person.email?.trim() ? (
                    <>
                      <dt className="text-[var(--text-tertiary)] shrink-0 pt-0.5">Email</dt>
                      <dd className="min-w-0 break-all">
                        <a
                          href={`mailto:${person.email.trim()}`}
                          className="text-[var(--accent-green)] underline underline-offset-2"
                        >
                          {person.email.trim()}
                        </a>
                      </dd>
                    </>
                  ) : null}
                  {li?.publicProfileUrl ? (
                    <>
                      <dt className="text-[var(--text-tertiary)] shrink-0 pt-0.5">LinkedIn</dt>
                      <dd className="min-w-0 break-all">
                        <a
                          href={li.publicProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--accent-green)] underline underline-offset-2"
                        >
                          Public profile
                        </a>
                      </dd>
                    </>
                  ) : null}
                  {li?.providerMemberId ? (
                    <>
                      <dt className="text-[var(--text-tertiary)] shrink-0 pt-0.5">Member id</dt>
                      <dd className="font-mono text-xs sm:text-sm text-[var(--text-secondary)] break-all">
                        {li.providerMemberId}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <p className="text-xs text-[var(--text-tertiary)] leading-relaxed pt-2 max-w-3xl">
                  History merges CRM notes, workflow artifacts (drafts, intake, sends), and workflow rows
                  linked to this person. Newest first.
                </p>
              </div>

              <div className="px-4 sm:px-6 py-3 sm:py-4">
                <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wide text-[var(--text-tertiary)] mb-3">
                  Activity ({events.length})
                </h3>
                {events.length === 0 ? (
                  <p className="text-sm text-[var(--text-tertiary)] py-6 text-center">
                    No activity recorded yet for this contact.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {events.map((ev, idx) => (
                      <li
                        key={`${ev.kind}-${ev.at}-${idx}`}
                        className="rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-secondary)]/50 px-3 sm:px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 gap-y-1 mb-1.5">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded border ${kindBadgeClass(ev.kind)}`}
                          >
                            {kindLabel(ev.kind)}
                          </span>
                          <time
                            className="text-xs text-[var(--text-tertiary)] tabular-nums"
                            dateTime={ev.at}
                          >
                            {formatWhen(ev.at)}
                          </time>
                        </div>
                        <p className="text-sm sm:text-base font-medium text-[var(--text-primary)] leading-snug">
                          {ev.title}
                        </p>
                        {ev.workflowName ? (
                          <p className="text-xs sm:text-sm text-[var(--text-tertiary)] mt-1 leading-snug">
                            {ev.workflowName}
                            {ev.stage ? ` · ${ev.stage.replace(/_/g, " ")}` : ""}
                          </p>
                        ) : null}
                        {ev.detail ? (
                          <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed line-clamp-6">
                            {ev.detail}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Stroke icon so it stays visible on dark panels (filled icons can disappear against similar fills). */
export function TimInspectContactIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.75}
      stroke="currentColor"
      className={className ?? "w-4 h-4"}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}
