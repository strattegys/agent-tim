"use client";

export interface Note {
  id: string;
  noteNumber: number;
  /** e.g. NT5001 */
  publicRef?: string;
  agentId: string;
  title: string;
  content: string | null;
  tag: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

const TAG_COLORS: Record<string, string> = {
  personal: "#E879A8",
  work: "#5B8DEF",
  reference: "#1D9E75",
  people: "#F97316",
};

interface NoteCardProps {
  note: Note;
  onDelete?: (id: string) => void;
  isFocused?: boolean;
  onToggleSuziFocus?: () => void;
}

export default function NoteCard({
  note,
  onDelete,
  isFocused = false,
  onToggleSuziFocus,
}: NoteCardProps) {
  const tagColor = TAG_COLORS[note.tag || ""] || "#A78BFA";

  const selectable = Boolean(onToggleSuziFocus);

  return (
    <div
      className={`rounded-lg border bg-[var(--bg-secondary)] p-3 transition-[box-shadow,border-color] group ${
        isFocused
          ? "border-2 border-[var(--accent-green)] shadow-[0_0_0_1px_var(--accent-green)]"
          : "border border-[var(--border-color)]"
      } ${selectable ? "cursor-pointer" : ""}`}
      onClick={selectable ? () => onToggleSuziFocus?.() : undefined}
      title={
        selectable
          ? isFocused
            ? "Focused for Suzi — tap to clear"
            : "Tap to focus for Suzi chat"
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        {/* Pin indicator */}
        {note.pinned && (
          <span className="text-xs mt-0.5 shrink-0" title="Pinned">
            📌
          </span>
        )}

        <div className="flex-1 min-w-0">
          {/* Title with note number */}
          <div className="flex items-start justify-between gap-1">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              <span className="text-[var(--text-tertiary)] font-mono mr-1">
                {note.publicRef?.trim() || `NT${note.noteNumber}`}
              </span>
              {note.title}
            </span>
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(note.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-red-400 transition-all shrink-0 p-0.5"
                title="Delete note"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Content preview */}
          {note.content && (
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 line-clamp-3 whitespace-pre-wrap">
              {note.content}
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {note.tag && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: `${tagColor}22`, color: tagColor }}
              >
                {note.tag}
              </span>
            )}
            <span className="text-[9px] text-[var(--text-tertiary)]">
              {new Date(note.updatedAt).toLocaleDateString("en-US", {
                timeZone: "America/Los_Angeles",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
