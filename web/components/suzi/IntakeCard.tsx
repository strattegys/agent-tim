"use client";

/** Mirrors API / DB shape; keep free of `@/lib/intake` so the client bundle does not pull `db`. */
export interface IntakeCardItem {
  id: string;
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

interface IntakeCardProps {
  item: IntakeCardItem;
  onDelete?: (id: string) => void;
}

export default function IntakeCard({ item, onDelete }: IntakeCardProps) {
  const src = item.source || "ui";
  const label = SOURCE_LABEL[src] || src;
  const color = SOURCE_COLOR[src] || "#8b9199";

  return (
    <div className="h-60 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 flex flex-col transition-colors group overflow-hidden">
      <div className="flex items-start justify-between gap-1.5 shrink-0">
        <h3 className="text-xs font-semibold text-[var(--text-primary)] line-clamp-2 leading-snug flex-1 min-w-0">
          {item.title}
        </h3>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-red-400 transition-all shrink-0 p-0.5"
            title="Delete"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[#5B8DEF] hover:underline truncate shrink-0 mt-1.5 block"
          title={item.url}
        >
          {item.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      )}

      <div className="flex-1 min-h-0 mt-2 overflow-y-auto overflow-x-hidden pr-0.5 [scrollbar-gutter:stable]">
        {item.body?.trim() ? (
          <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {item.body}
          </p>
        ) : item.url ? (
          <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">No text in the message — use the link above.</p>
        ) : (
          <p className="text-[10px] text-[var(--text-tertiary)] italic">No details captured.</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 shrink-0 flex-wrap border-t border-[var(--border-color)]/60">
        <span
          className="text-[9px] px-2 py-0.5 rounded-full font-medium"
          style={{ background: `${color}22`, color }}
        >
          {label}
        </span>
        <span className="text-[9px] text-[var(--text-tertiary)]">
          {new Date(item.updatedAt).toLocaleDateString("en-US", {
            timeZone: "America/Los_Angeles",
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </div>
  );
}
