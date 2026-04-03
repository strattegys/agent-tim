"use client";

import { useMemo, useState } from "react";

const SEE_MORE_CHARS = 210;

function stripMarkdownLite(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function extractFirstMarkdownImageUrl(markdown: string): string | null {
  const m = markdown.match(/!\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)\s*\)/i);
  return m?.[1]?.trim() || null;
}

export function extractFeatureImageLine(markdown: string): string | null {
  const line = markdown
    .split("\n")
    .find((l) => /^(feature|hero|cover)\s*image\s*:/i.test(l.trim()));
  if (!line) return null;
  const url = line.replace(/^[^:]+:\s*/i, "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Parse optional "## First comment" section from POST_DRAFTED markdown. */
export function splitPostAndFirstComment(markdown: string): { post: string; firstComment: string | null } {
  const re = /^##\s*first\s*comment\s*$/im;
  const idx = markdown.search(re);
  if (idx === -1) return { post: markdown.trim(), firstComment: null };
  const post = markdown.slice(0, idx).trim();
  const rest = markdown.slice(idx).replace(/^##\s*first\s*comment\s*$/im, "").trim();
  return { post, firstComment: rest || null };
}

interface LinkedInPostPreviewCardProps {
  postMarkdown: string;
  firstCommentMarkdown?: string | null;
  imageUrl?: string | null;
  /** Shown as author line (approximate preview). */
  authorLabel?: string;
  className?: string;
}

/**
 * Approximate LinkedIn feed card for review (not pixel-perfect).
 */
export default function LinkedInPostPreviewCard({
  postMarkdown,
  firstCommentMarkdown,
  imageUrl,
  authorLabel = "You",
  className = "",
}: LinkedInPostPreviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const plainPost = useMemo(() => stripMarkdownLite(postMarkdown || ""), [postMarkdown]);
  const truncated =
    !expanded && plainPost.length > SEE_MORE_CHARS
      ? `${plainPost.slice(0, SEE_MORE_CHARS).trim()}…`
      : plainPost;
  const img =
    imageUrl?.trim() ||
    extractFirstMarkdownImageUrl(postMarkdown) ||
    extractFeatureImageLine(postMarkdown) ||
    null;
  const commentPlain = useMemo(
    () => (firstCommentMarkdown ? stripMarkdownLite(firstCommentMarkdown) : ""),
    [firstCommentMarkdown]
  );

  return (
    <div
      className={`rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden shadow-sm ${className}`.trim()}
    >
      <div className="px-3 py-2 border-b border-[var(--border-color)]/70 bg-[var(--bg-primary)]/40">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          LinkedIn preview
        </div>
        <p className="text-[9px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
          Approximate layout — line breaks and “see more” differ on LinkedIn.
        </p>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex gap-2.5">
          <div
            className="h-10 w-10 shrink-0 rounded-full bg-[var(--border-color)]/80 border border-[var(--border-color)]"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-[var(--text-primary)] leading-tight">{authorLabel}</div>
            <div className="text-[10px] text-[var(--text-tertiary)] leading-tight">Strattegys · 1st</div>
            <div className="text-[9px] text-[var(--text-tertiary)] mt-0.5">Just now · 🌐</div>
          </div>
        </div>
        <div className="text-[13px] leading-relaxed text-[var(--text-chat-body)] whitespace-pre-wrap break-words">
          {truncated || (
            <span className="text-[var(--text-tertiary)] italic">No post body in POST_DRAFTED yet.</span>
          )}
        </div>
        {plainPost.length > SEE_MORE_CHARS ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {expanded ? "See less" : "…see more"}
          </button>
        ) : null}
        {img ? (
          <div className="rounded-lg overflow-hidden border border-[var(--border-color)]/60 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="w-full max-h-[220px] object-cover" loading="lazy" />
          </div>
        ) : null}
        <div className="flex gap-4 text-[10px] text-[var(--text-tertiary)] pt-1 border-t border-[var(--border-color)]/50">
          <span>👍 Like</span>
          <span>💬 Comment</span>
          <span>↗ Repost</span>
          <span>✈ Send</span>
        </div>
        {commentPlain ? (
          <div className="rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-primary)]/50 px-3 py-2.5 space-y-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              First comment (after post)
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--text-chat-body)] whitespace-pre-wrap break-words">
              {commentPlain}
            </p>
          </div>
        ) : (
          <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">
            Add a <strong className="text-[var(--text-secondary)]">## First comment</strong> section in{" "}
            <strong className="text-[var(--text-secondary)]">POST_DRAFTED</strong>, or a separate artifact, so the
            article link can live in the first comment only.
          </p>
        )}
      </div>
    </div>
  );
}
