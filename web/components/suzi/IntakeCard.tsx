"use client";

import { useEffect, useState } from "react";

/** Mirrors API / DB shape; keep free of `@/lib/intake` so the client bundle does not pull `db`. */
export interface IntakeCardItem {
  id: string;
  /** Stable DB itemNumber (same as intake tool); omit or 0 if pre-migration row. */
  itemNumber?: number;
  title: string;
  url: string | null;
  body: string | null;
  source: string;
  updatedAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  ui: "Manual",
  agent: "Suzi",
  share: "Share",
  email: "Email",
};

const SOURCE_COLOR: Record<string, string> = {
  ui: "#5B8DEF",
  agent: "#D85A30",
  share: "#1D9E75",
  email: "#A78BFA",
};

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 8v11H3V8" />
      <path d="M23 3H1v5h22V3z" />
      <path d="M10 12h4" />
    </svg>
  );
}

interface IntakeCardProps {
  item: IntakeCardItem;
  /** Soft-archive: removes from the active queue (same as API archive). */
  onArchive?: (id: string) => void;
  /** User selected this card for Suzi chat context. */
  isFocused?: boolean;
  /** Click card body to toggle focus (archive / link clicks do not toggle). */
  onToggleFocus?: () => void;
}

/** Pacific time after mount only — avoids SSR/client Intl mismatches for `toLocaleString`. */
function IntakeUpdatedLabel({ updatedAt }: { updatedAt: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(
      new Date(updatedAt).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }, [updatedAt]);
  return (
    <span className="text-xs text-[var(--text-tertiary)] tabular-nums min-h-[1em] ml-auto shrink-0 text-right break-words max-w-[10rem]">
      {text ?? "\u00a0"}
    </span>
  );
}

export default function IntakeCard({
  item,
  onArchive,
  isFocused = false,
  onToggleFocus,
}: IntakeCardProps) {
  const stableNum = item.itemNumber != null && item.itemNumber > 0 ? item.itemNumber : null;
  const src = item.source || "ui";
  const label = SOURCE_LABEL[src] || src;
  const color = SOURCE_COLOR[src] || "#8b9199";
  const selectable = Boolean(onToggleFocus);

  return (
    <div
      className={`h-full min-h-0 w-full min-w-0 rounded-lg bg-[var(--bg-secondary)] p-2 flex flex-col outline-none transition-[box-shadow,border-color] ${
        isFocused
          ? "border-2 border-[var(--accent-green)] shadow-[0_0_0_1px_var(--accent-green)]"
          : "border border-[var(--border-color)]"
      } ${selectable ? "cursor-pointer" : ""}`}
      onClick={selectable ? () => onToggleFocus?.() : undefined}
      title={
        selectable
          ? (isFocused ? "Focused for Suzi — tap to clear" : "Tap to focus for Suzi chat")
          : undefined
      }
    >
      <div className="flex items-start gap-1.5 shrink-0">
        <div className="flex items-start gap-1.5 min-w-0 flex-1">
          {stableNum != null && (
            <span
              className="shrink-0 text-xs font-bold tabular-nums px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent-green)] leading-none"
              title={`Intake #${stableNum} — stable record id; use intake tool itemNumber ${stableNum}, or archive here`}
            >
              #{stableNum}
            </span>
          )}
          <h3 className="text-sm font-medium text-[var(--text-chat-body)] leading-snug flex-1 min-w-0 break-words">
            {item.title}
          </h3>
        </div>
        {onArchive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(item.id);
            }}
            className="shrink-0 p-0.5 rounded text-[var(--text-tertiary)] hover:text-[#D85A30] hover:bg-[var(--bg-primary)] border border-transparent hover:border-[var(--border-color)]"
            title="Archive — remove from queue (recoverable from DB if needed)"
          >
            <ArchiveIcon />
          </button>
        )}
      </div>

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-[var(--text-secondary)] hover:text-[#5B8DEF] hover:underline mt-1.5 block leading-snug break-all"
        >
          {item.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      )}

      <div className="mt-2 min-h-0 min-w-0 flex-1 overflow-y-auto">
        {item.body?.trim() ? (
          <p className="text-base leading-relaxed text-[var(--text-chat-body)] whitespace-pre-wrap break-words">
            {item.body}
          </p>
        ) : item.url ? (
          <p className="text-xs text-[var(--text-tertiary)] leading-snug">
            No text — open link above.
          </p>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)] italic">No details.</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-1.5 shrink-0 border-t border-[var(--border-color)]/50 flex-wrap">
        <span
          className="text-xs px-1.5 py-px rounded-full font-medium shrink-0 max-w-full break-words"
          style={{ background: `${color}22`, color }}
        >
          {label}
        </span>
        <IntakeUpdatedLabel updatedAt={item.updatedAt} />
      </div>
    </div>
  );
}
