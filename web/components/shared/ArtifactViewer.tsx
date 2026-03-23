"use client";

import { useState, useEffect } from "react";

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

interface ArtifactViewerProps {
  /** Fetch artifacts for this workflow item */
  workflowItemId?: string;
  /** Or fetch all artifacts for a workflow */
  workflowId?: string;
  /** Pre-loaded artifact to display */
  artifact?: Artifact;
  /** "person" shows a people table, "content" shows artifact markdown */
  itemType?: string;
  onClose: () => void;
}

/**
 * Inspect modal — for content workflows shows artifact tabs,
 * for person workflows shows a people table grouped by stage.
 */
export default function ArtifactViewer({
  workflowItemId,
  workflowId,
  artifact: preloaded,
  itemType = "content",
  onClose,
}: ArtifactViewerProps) {
  const isPerson = itemType === "person";

  // Content mode state
  const [artifacts, setArtifacts] = useState<Artifact[]>(preloaded ? [preloaded] : []);
  const [activeIdx, setActiveIdx] = useState(0);

  // Person mode state
  const [people, setPeople] = useState<PersonItem[]>([]);
  const [activeStage, setActiveStage] = useState<string>("");

  const [loading, setLoading] = useState(!preloaded);

  useEffect(() => {
    if (preloaded) return;
    if (!workflowId && !workflowItemId) return;

    if (isPerson && workflowId) {
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
          const arts = data.artifacts || [];
          setArtifacts(arts);
          if (arts.length > 0) setActiveIdx(arts.length - 1);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [workflowItemId, workflowId, preloaded, isPerson]);

  const active = artifacts[activeIdx];

  // Person mode: group by stage
  const personStages = isPerson ? [...new Set(people.map((p) => p.stage))] : [];
  const filteredPeople = isPerson ? people.filter((p) => p.stage === activeStage) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] w-[90vw] max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent-green)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {isPerson ? (
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
            <span className="text-sm font-bold text-[var(--text-primary)]">
              {isPerson ? "People Pipeline" : (active?.name || "Artifacts")}
            </span>
            {!isPerson && active && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                {active.stage}
              </span>
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
        {isPerson ? (
          personStages.length > 1 && (
            <div className="flex gap-1 px-5 py-2 border-b border-[var(--border-color)] overflow-x-auto">
              {personStages.map((stage) => {
                const count = people.filter((p) => p.stage === stage).length;
                return (
                  <button
                    key={stage}
                    onClick={() => setActiveStage(stage)}
                    className={`text-[11px] px-3 py-1 rounded-full whitespace-nowrap transition-colors ${
                      stage === activeStage
                        ? "bg-[var(--accent-green)] text-white font-semibold"
                        : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {stage} ({count})
                  </button>
                );
              })}
            </div>
          )
        ) : (
          artifacts.length > 1 && (
            <div className="flex gap-1 px-5 py-2 border-b border-[var(--border-color)] overflow-x-auto">
              {artifacts.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => setActiveIdx(i)}
                  className={`text-[11px] px-3 py-1 rounded-full whitespace-nowrap transition-colors ${
                    i === activeIdx
                      ? "bg-[var(--accent-green)] text-white font-semibold"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center text-[var(--text-tertiary)] py-8">
              Loading...
            </div>
          ) : isPerson ? (
            filteredPeople.length === 0 ? (
              <div className="text-center text-[var(--text-tertiary)] py-8">
                No people at this stage
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--border-color)]">
                    <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-semibold">Name</th>
                    <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-semibold">Title / Company</th>
                    <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-semibold">Stage</th>
                    <th className="text-left py-2 px-2 text-[var(--text-tertiary)] font-semibold">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPeople.map((p) => (
                    <tr key={p.itemId} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]">
                      <td className="py-2 px-2 text-[var(--text-primary)] font-medium">
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
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <MarkdownRenderer content={active.content} />
            </div>
          )}
        </div>

        {/* Footer */}
        {isPerson ? (
          <div className="px-5 py-2.5 border-t border-[var(--border-color)] text-[10px] text-[var(--text-tertiary)]">
            {people.length} total people across {personStages.length} stages
          </div>
        ) : active ? (
          <div className="px-5 py-2.5 border-t border-[var(--border-color)] flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
            <span>
              Created: {new Date(active.createdAt).toLocaleString()}
            </span>
            <span className="uppercase">{active.type}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Simple markdown renderer — converts basic markdown to HTML.
 */
function MarkdownRenderer({ content }: { content: string }) {
  const html = markdownToHtml(content);
  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      className="text-[13px] leading-relaxed text-[var(--text-primary)]"
      style={{ lineHeight: "1.7" }}
    />
  );
}

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
